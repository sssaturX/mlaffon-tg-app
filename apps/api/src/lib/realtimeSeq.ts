import { getRedis } from "./redis.js";

const BROADCAST_SEQ_KEY = "mlaffon:realtime:broadcast_seq";

/** Последний присвоенный seq broadcast-сообщениям (для initial_state и gap-detection на клиенте). */
export async function getLastBroadcastSeq(): Promise<number> {
  const v = await getRedis().get(BROADCAST_SEQ_KEY);
  if (v == null || v === "") return 0;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Следующий монотонный seq (INCR в Redis). */
export async function nextBroadcastSeq(): Promise<number> {
  return getRedis().incr(BROADCAST_SEQ_KEY);
}
