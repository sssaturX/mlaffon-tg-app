import { getRedis } from "./redis.js";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = Number.parseInt(
  process.env.WS_CONNECT_ATTEMPTS_PER_MINUTE ?? "30",
  10
);
const MAX_CONCURRENT_PER_IP = Number.parseInt(
  process.env.WS_MAX_CONCURRENT_PER_IP ?? "8",
  10
);

function minuteBucket(): string {
  return String(Math.floor(Date.now() / WINDOW_MS));
}

/**
 * Reject reconnect storms: many upgrade attempts per IP per rolling minute window.
 */
export async function assertWsConnectThrottleAllowed(
  clientIp: string
): Promise<boolean> {
  const key = `ws_conn_throttle:${clientIp}:${minuteBucket()}`;
  const n = await getRedis().incr(key);
  if (n === 1) {
    await getRedis().expire(key, Math.ceil(WINDOW_MS / 1000) * 2);
  }
  return n <= MAX_ATTEMPTS_PER_WINDOW;
}

const ACTIVE_PREFIX = "ws_conn_active:";

/** Track concurrent WS per IP (best-effort; decremented on socket close). */
export async function registerWsConnectionActive(
  clientIp: string
): Promise<{ ok: true } | { ok: false; reason: "too_many" }> {
  const key = `${ACTIVE_PREFIX}${clientIp}`;
  const n = await getRedis().incr(key);
  if (n === 1) {
    await getRedis().expire(key, 600);
  }
  if (n > MAX_CONCURRENT_PER_IP) {
    await getRedis().decr(key);
    return { ok: false, reason: "too_many" };
  }
  return { ok: true };
}

export function releaseWsConnectionActive(clientIp: string): void {
  const key = `${ACTIVE_PREFIX}${clientIp}`;
  void getRedis().decr(key).catch(() => {
    /* ignore */
  });
}
