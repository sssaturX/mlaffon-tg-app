import { getRedis } from "../lib/redis.js";
import type { TaskDto } from "shared";

const KEY_PREFIX = "mlaffon:tasks:userdto:v1:";
const TTL_SEC = 20;

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
    /* Redis недоступен */
  }
}

export function invalidateUserTaskDtoCache(userId: string): void {
  void getRedis()
    .del(cacheKey(userId))
    .catch(() => {
      /* ignore */
    });
}

/** Сброс кэшей списков заданий у всех пользователей (каталог заданий изменился). */
export async function flushAllUserTaskDtoCaches(): Promise<void> {
  try {
    const r = getRedis();
    const keys = await r.keys(`${KEY_PREFIX}*`);
    if (keys.length > 0) await r.del(...keys);
  } catch {
    /* ignore */
  }
}
