import { getRedis } from "./redis.js";

export async function assertClaimRateLimits(
  userId: string,
  ip: string | undefined
): Promise<{ ok: true } | { ok: false; reason: "user" | "ip" }> {
  const r = getRedis();
  const uKey = `ab:claim:u:${userId}`;
  const uMax = Number(process.env.ABUSE_CLAIM_PER_USER_PER_MIN ?? 30);
  const ipMax = Number(process.env.ABUSE_CLAIM_PER_IP_PER_MIN ?? 200);

  const n = await r.incr(uKey);
  if (n === 1) await r.expire(uKey, 60);
  if (n > uMax) return { ok: false, reason: "user" };

  if (ip && ip !== "unknown") {
    const iKey = `ab:claim:ip:${ip}`;
    const m = await r.incr(iKey);
    if (m === 1) await r.expire(iKey, 60);
    if (m > ipMax) return { ok: false, reason: "ip" };
  }

  return { ok: true };
}

export async function assertOAuthCallbackRate(ip: string | undefined): Promise<boolean> {
  if (!ip || ip === "unknown") return true;
  const r = getRedis();
  const key = `ab:oauth:ip:${ip}`;
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, 60);
  const max = Number(process.env.ABUSE_OAUTH_CALLBACK_PER_IP_PER_MIN ?? 60);
  return n <= max;
}
