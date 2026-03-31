import { getRedis } from "../lib/redis.js";
import { notifyBalanceUpdated } from "./balanceWs.js";

const CHANNEL = "balance_updates";

let subscriber: ReturnType<typeof getRedis> | null = null;

function getSubscriber() {
  if (!subscriber) {
    subscriber = getRedis().duplicate();
  }
  return subscriber;
}

export async function publishBalanceUpdate(userId: string): Promise<void> {
  try {
    await getRedis().publish(CHANNEL, userId);
  } catch {
    notifyBalanceUpdated(userId);
  }
}

export async function startBalanceEventSubscriber(
  log: { warn: (o: Record<string, unknown>, m: string) => void }
): Promise<void> {
  try {
    const sub = getSubscriber();
    await sub.subscribe(CHANNEL);
    sub.on("message", (ch, msg) => {
      if (ch === CHANNEL) notifyBalanceUpdated(msg);
    });
  } catch (e) {
    log.warn(
      { err: e },
      "balance_events: Redis subscriber unavailable; worker balance pushes may not reach clients"
    );
  }
}
