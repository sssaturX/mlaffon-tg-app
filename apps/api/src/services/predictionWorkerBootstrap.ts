import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { predictions } from "../db/schema.js";
import { schedulePredictionAutoCloseJob } from "./predictionScheduler.js";

/** После деплоя / рестарта worker — восстановить delayed jobs для уже активных предиктов. */
export async function rehydratePredictionAutoCloseJobs(): Promise<void> {
  const rows = await db
    .select({
      id: predictions.id,
      autoCloseAt: predictions.autoCloseAt,
    })
    .from(predictions)
    .where(
      and(
        eq(predictions.status, "active"),
        sql`${predictions.autoCloseAt} is not null`
      )
    );
  for (const r of rows) {
    if (r.autoCloseAt) {
      await schedulePredictionAutoCloseJob(r.id, r.autoCloseAt);
    }
  }
}
