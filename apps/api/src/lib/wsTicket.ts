import { randomBytes } from "node:crypto";
import { getRedis } from "./redis.js";

const PREFIX = "ws_ticket:";
/** One-time ticket TTL (seconds). */
const TTL_SEC = Number.parseInt(process.env.WS_TICKET_TTL_SEC ?? "25", 10);

export async function issueWsTicket(userId: string): Promise<string> {
  const ticket = randomBytes(24).toString("base64url");
  await getRedis().set(`${PREFIX}${ticket}`, userId, "EX", TTL_SEC);
  return ticket;
}

/** Atomically read and delete ticket; returns userId or null if missing/expired. */
export async function consumeWsTicket(ticket: string): Promise<string | null> {
  if (!ticket || ticket.length > 512) return null;
  const key = `${PREFIX}${ticket}`;
  const userId = await getRedis().getdel(key);
  return userId ?? null;
}
