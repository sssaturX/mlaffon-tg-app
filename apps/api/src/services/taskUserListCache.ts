import { getRedis } from "../lib/redis.js";
import type { TaskDto } from "shared";

/** Версия кэша: bump при смене семантики listTasksForUser (см. tasks.ts). */
const KEY_PREFIX = "mlaffon:tasks:userdto:v2:";
const TTL_SEC = 30;

function cacheKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export async function getCachedUserTaskDtoList(
  userId: string
): Promise<TaskDto[] | null> {
  try {
    const raw = await getRedis().get(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TaskDto[];
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedUserTaskDtoList(
  userId: string,
  rows: TaskDto[]
): Promise<void> {
  try {
    await getRedis().setex(cacheKey(userId), TTL_SEC, JSON.stringify(rows));
  } catch {
    /* Redis unavailable */
  }
}

export function invalidateUserTaskDtoCache(userId: string): void {
  void getRedis()
    .del(cacheKey(userId))
    .catch(() => {
      /* ignore */
    });
}

/**
 * Flush all per-user task DTO caches using SCAN (non-blocking).
 * Previous implementation used KEYS which blocks Redis event loop at scale.
 */
export async function flushAllUserTaskDtoCaches(): Promise<void> {
  try {
    const r = getRedis();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await r.scan(
        cursor,
        "MATCH",
        `${KEY_PREFIX}*`,
        "COUNT",
        200
      );
      cursor = nextCursor;
      if (keys.length > 0) await r.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* ignore */
  }
}
