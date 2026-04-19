import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { tasks } from "../db/schema.js";
import { getRedis } from "../lib/redis.js";
import { singleFlight } from "../lib/singleFlight.js";
import { flushAllUserTaskDtoCaches } from "./taskUserListCache.js";

const CACHE_KEY = "mlaffon:tasks:active:v1";
/** Каталог заданий меняется редко; дольше TTL — меньше холодных промахов в Postgres. */
const TTL_SEC = 300;

export type CachedTaskRow = typeof tasks.$inferSelect;

/**
 * Список активных заданий (редко меняется) — кэш в Redis, чтобы не бить Postgres на каждый GET /tasks.
 */
export async function getActiveTasksCached(): Promise<CachedTaskRow[]> {
  try {
    const r = getRedis();
    const raw = await r.get(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CachedTaskRow[];
      if (Array.isArray(parsed) && parsed.length >= 0) return parsed;
    }
  } catch {
    /* Redis недоступен — только БД */
  }

  return singleFlight("mlaffon:tasks:active:loader", async () => {
    try {
      const raw = await getRedis().get(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CachedTaskRow[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore */
    }
    const rows = await db.select().from(tasks).where(eq(tasks.active, true));
    try {
      await getRedis().setex(CACHE_KEY, TTL_SEC, JSON.stringify(rows));
    } catch {
      /* ignore */
    }
    return rows;
  });
}

/** Вызывать после изменения заданий в админке / сиде. */
export function invalidateActiveTasksCache(): void {
  void getRedis()
    .del(CACHE_KEY)
    .catch(() => {
      /* ignore */
    });
  void flushAllUserTaskDtoCaches().catch(() => {
    /* ignore */
  });
}
