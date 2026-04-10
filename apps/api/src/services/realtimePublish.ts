import type { HomeGiveawaysResponse } from "shared";
import { getRedis } from "../lib/redis.js";
import { REALTIME_REDIS_CHANNEL } from "../lib/realtimeChannel.js";
import { db } from "../db/index.js";
import { outboxEvents } from "../db/schema.js";
import { broadcastJson, sendToUser } from "./realtimeWs.js";
import type { GiveawayListItem } from "./giveaways.js";
import { buildMeEconomyPatch } from "./me.js";
const PUBLISH_RETRIES = 2;
const PUBLISH_RETRY_DELAY_MS = 150;

let subscriber: ReturnType<typeof getRedis> | null = null;

function getSubscriber() {
  if (!subscriber) {
    subscriber = getRedis().duplicate();
  }
  return subscriber;
}

async function redisPublishWithRetry(payload: string): Promise<boolean> {
  for (let attempt = 0; attempt <= PUBLISH_RETRIES; attempt++) {
    try {
      await getRedis().publish(REALTIME_REDIS_CHANNEL, payload);
      return true;
    } catch (e) {
      if (attempt < PUBLISH_RETRIES) {
        await new Promise((r) => setTimeout(r, PUBLISH_RETRY_DELAY_MS));
      } else {
        console.warn("realtime: Redis publish failed after retries", e);
      }
    }
  }
  return false;
}

export type BroadcastWsEvent =
  | {
      type: "drop_started";
      v: 1;
      data: {
        dropId: string;
        endsAt: string;
        serverNow: string;
        remainingSeconds: number;
        platform: string;
        maxWinners: number;
        winnersCount: number;
      };
    }
  | { type: "drop_finished"; v: 1; data: { dropId: string } }
  | {
      type: "live_started";
      v: 1;
      data: {
        id: string;
        platform: string;
        streamUrl: string;
        startedAt: string;
        vpnNote: string | null;
      };
    }
  | { type: "live_ended"; v: 1 }
  | {
      type: "prediction_state";
      v: 1;
      data: {
        id: string;
        title: string;
        status: string;
        optionA: string;
        optionB: string;
        platform: { id: string; type: string; name: string };
        totalPool: number;
        optionAPool: number;
        optionBPool: number;
        participantsA: number;
        participantsB: number;
        coefficientA: number | null;
        coefficientB: number | null;
        startAt: string | null;
        autoCloseAt: string | null;
        closedAt: string | null;
        resolvedAt: string | null;
        winnerOption: "A" | "B" | null;
        myBet: { option: "A" | "B"; amount: number } | null;
        myPlatformBalance: number | null;
      };
    }
  | {
      type: "giveaways_updated";
      v: 1;
      data: {
        home: HomeGiveawaysResponse;
        list: GiveawayListItem[];
      };
    };

export type DropClaimedEvent = {
  type: "drop_claimed";
  v: 1;
  data: { dropId: string; reward: number };
};

export async function publishUserEvent(
  userId: string,
  event: unknown
): Promise<void> {
  const payload = JSON.stringify({ scope: "user" as const, userId, event });
  const ok = await redisPublishWithRetry(payload);
  if (!ok) {
    sendToUser(userId, event);
  }
}

export async function publishBalanceUpdate(userId: string): Promise<void> {
  let patch;
  try {
    patch = await buildMeEconomyPatch(userId);
  } catch {
    return;
  }
  const event = { type: "me_update" as const, v: 1 as const, data: patch };
  const payload = JSON.stringify({ scope: "user" as const, userId, event });
  const ok = await redisPublishWithRetry(payload);
  if (!ok) {
    sendToUser(userId, event);
  }
}

/** Broadcast только через outbox → worker вешает `seq` и шлёт в Redis (см. outboxFlush). */
export async function publishBroadcastEvent(
  event: BroadcastWsEvent
): Promise<void> {
  await db.insert(outboxEvents).values({
    event: event as unknown as Record<string, unknown>,
  });
}

export async function startRealtimeSubscriber(
  log: { warn: (o: Record<string, unknown>, m: string) => void }
): Promise<void> {
  const sub = getSubscriber();

  const connect = async () => {
    try {
      await sub.subscribe(REALTIME_REDIS_CHANNEL);
    } catch (e) {
      log.warn(
        { err: e },
        "realtime: Redis subscriber unavailable; cross-process pushes may not reach clients"
      );
    }
  };

  sub.on("message", (_: string, msg: string) => {
    try {
      const parsed = JSON.parse(msg) as {
        scope?: string;
        userId?: string;
        event?: unknown;
      };
      if (parsed.scope === "user" && parsed.userId && parsed.event) {
        sendToUser(parsed.userId, parsed.event);
      } else if (parsed.scope === "broadcast" && parsed.event) {
        broadcastJson(parsed.event);
      }
    } catch {
      const u = msg.trim();
      if (/^[0-9a-f-]{36}$/i.test(u)) {
        sendToUser(u, { type: "balance_updated" });
      }
    }
  });

  sub.on("error", (err: Error) => {
    log.warn({ err: err.message }, "realtime: Redis subscriber error");
  });

  await connect();
}
