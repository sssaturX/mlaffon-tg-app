import { getRedis } from "../lib/redis.js";
import { broadcastJson, sendToUser } from "./realtimeWs.js";
import { buildMeEconomyPatch } from "./me.js";

const CHANNEL = "mlaffon_realtime";

let subscriber: ReturnType<typeof getRedis> | null = null;

function getSubscriber() {
  if (!subscriber) {
    subscriber = getRedis().duplicate();
  }
  return subscriber;
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

/**
 * Событие одному пользователю (все инстансы API получают из Redis и шлют в локальные сокеты).
 */
export async function publishUserEvent(
  userId: string,
  event: unknown
): Promise<void> {
  try {
    await getRedis().publish(
      CHANNEL,
      JSON.stringify({
        scope: "user" as const,
        userId,
        event,
      })
    );
  } catch {
    sendToUser(userId, event);
  }
}

/**
 * После изменения баланса — пуш среза полей профиля (без полного GET /me).
 */
export async function publishBalanceUpdate(userId: string): Promise<void> {
  let patch;
  try {
    patch = await buildMeEconomyPatch(userId);
  } catch {
    return;
  }
  const event = { type: "me_update" as const, v: 1 as const, data: patch };
  try {
    await getRedis().publish(
      CHANNEL,
      JSON.stringify({
        scope: "user" as const,
        userId,
        event,
      })
    );
  } catch {
    sendToUser(userId, event);
  }
}

export async function publishBroadcastEvent(
  event: BroadcastWsEvent
): Promise<void> {
  try {
    await getRedis().publish(
      CHANNEL,
      JSON.stringify({ scope: "broadcast" as const, event })
    );
  } catch {
    broadcastJson(event);
  }
}

export async function startRealtimeSubscriber(
  log: { warn: (o: Record<string, unknown>, m: string) => void }
): Promise<void> {
  try {
    const sub = getSubscriber();
    await sub.subscribe(CHANNEL);
    sub.on("message", (_, msg) => {
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
  } catch (e) {
    log.warn(
      { err: e },
      "realtime: Redis subscriber unavailable; cross-process pushes may not reach clients"
    );
  }
}
