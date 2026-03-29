import { Redis } from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    client = new Redis(url, {
      maxRetriesPerRequest: null,
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
