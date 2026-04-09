import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { outboxEvents } from "../db/schema.js";
import { nextBroadcastSeq } from "../lib/realtimeSeq.js";
import { getRedis } from "../lib/redis.js";
import { REALTIME_REDIS_CHANNEL } from "../lib/realtimeChannel.js";
import type { BroadcastWsEvent } from "./realtimePublish.js";
const PUBLISH_RETRIES = 2;
const PUBLISH_RETRY_DELAY_MS = 150;

async function redisPublishWithRetry(payload: string): Promise<boolean> {
  const redis = getRedis();
  for (let attempt = 0; attempt <= PUBLISH_RETRIES; attempt++) {
    try {
      await redis.publish(REALTIME_REDIS_CHANNEL, payload);
      return true;
    } catch (e) {
      if (attempt < PUBLISH_RETRIES) {
        await new Promise((r) => setTimeout(r, PUBLISH_RETRY_DELAY_MS));
      } else {
        console.warn("outboxFlush: Redis publish failed after retries", e);
      }
    }
  }
  return false;
}

/**
 * Забирает пачку неотправленных broadcast-событий, вешает монотонный seq, публикует в Redis.
 * Вся выборка + пометки `published_at` — в **одной** SQL-транзакции с `FOR UPDATE SKIP LOCKED`,
 * иначе в Postgres блокировка снимается после автокоммита statement и возможна двойная отправка.
 * At-least-once: при падении после publish, до UPDATE — при следующем проходе новый seq (клиент может сделать catch-up по gap).
 */
export async function flushOutboxBatch(limit = 80): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: outboxEvents.id, event: outboxEvents.event })
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    let sent = 0;
    for (const row of rows) {
      const event = row.event as unknown as BroadcastWsEvent;
      const seq = await nextBroadcastSeq();
      const wire = { ...event, seq } as Record<string, unknown>;
      const payload = JSON.stringify({
        scope: "broadcast" as const,
        event: wire,
      });
      const ok = await redisPublishWithRetry(payload);
      if (!ok) break;

      await tx
        .update(outboxEvents)
        .set({ publishedAt: sql`now()` })
        .where(
          and(eq(outboxEvents.id, row.id), isNull(outboxEvents.publishedAt))
        );
      sent += 1;
    }
    return sent;
  });
}
