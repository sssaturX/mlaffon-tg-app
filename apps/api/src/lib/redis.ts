import { Redis } from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    client = new Redis(url, {
      maxRetriesPerRequest: null,
      connectTimeout: 10_000,
    });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

/** Ранний коннект к Redis, чтобы первый запрос (ws-ticket, кэш) не ждал handshake. */
export async function warmupRedis(): Promise<void> {
  try {
    await getRedis().ping();
  } catch {
    /* воркеры/API поднимутся при появлении Redis */
  }
}
