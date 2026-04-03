import { getRedis } from "../lib/redis.js";
import { broadcastJson, sendToUser } from "./realtimeWs.js";
import { buildMeEconomyPatch } from "./me.js";

const CHANNEL = "mlaffon_realtime";
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
      await getRedis().publish(CHANNEL, payload);
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
  | { type: "live_ended"; v: 1 };

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

export async function publishBroadcastEvent(
  event: BroadcastWsEvent
): Promise<void> {
  const payload = JSON.stringify({ scope: "broadcast" as const, event });
  const ok = await redisPublishWithRetry(payload);
  if (!ok) {
    broadcastJson(event);
  }
}

export async function startRealtimeSubscriber(
  log: { warn: (o: Record<string, unknown>, m: string) => void }
): Promise<void> {
  const sub = getSubscriber();

  const connect = async () => {
    try {
      await sub.subscribe(CHANNEL);
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
