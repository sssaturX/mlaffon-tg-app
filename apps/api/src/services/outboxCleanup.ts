import { and, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { outboxEvents } from "../db/schema.js";

const RETENTION_DAYS = 7;

/** Remove published outbox events older than RETENTION_DAYS. */
export async function cleanupOldOutboxEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const deleted = await db
    .delete(outboxEvents)
    .where(
      and(
        isNotNull(outboxEvents.publishedAt),
        lt(outboxEvents.createdAt, cutoff)
      )
    )
    .returning({ id: outboxEvents.id });
  return deleted.length;
}
