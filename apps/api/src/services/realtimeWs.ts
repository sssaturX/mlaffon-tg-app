import type { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import {
  assertWsConnectThrottleAllowed,
  registerWsConnectionActive,
  releaseWsConnectionActive,
} from "../lib/wsConnectThrottle.js";
import { consumeWsTicket } from "../lib/wsTicket.js";
import { isUserBanned } from "./userBan.js";
import { buildWsInitialState } from "./wsInitialState.js";

const userSockets = new Map<string, Set<WebSocket>>();

export function sendToUser(userId: string, event: unknown): void {
  const set = userSockets.get(userId);
  if (!set?.size) return;
  const msg = JSON.stringify(event);
  for (const s of set) {
    if (s.readyState === 1) {
      try {
        s.send(msg);
      } catch {
        /* ignore */
      }
    }
  }
}

export function broadcastJson(event: unknown): void {
  const msg = JSON.stringify(event);
  for (const set of userSockets.values()) {
    for (const s of set) {
      if (s.readyState === 1) {
        try {
          s.send(msg);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function trackSocket(userId: string, socket: WebSocket) {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  set.add(socket);
  const cleanup = () => {
    set!.delete(socket);
    if (set!.size === 0) userSockets.delete(userId);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

/**
 * WebSocket `/api/v1/ws?ticket=…` (one-time ticket from `POST /api/v1/ws-ticket`).
 * Client messages are ignored.
 */
export function getConnectedUserIds(): string[] {
  return Array.from(userSockets.keys());
}

function extractQueryParam(
  pathAndQuery: string,
  name: string
): string | null {
  try {
    const u = new URL(pathAndQuery, "http://localhost");
    const v = u.searchParams.get(name);
    if (v) return v;
  } catch {
    /* ignore */
  }
  const re = new RegExp(`[?&]${name}=([^&]*)`);
  const m = pathAndQuery.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function handleRealtimeWsConnection(
  socket: WebSocket,
  pathAndQuery: string,
  clientIp: string,
  log: { warn: (o: Record<string, unknown>, msg?: string) => void }
): Promise<void> {
  socket.on("message", () => {
    /* ignore */
  });

  const legacyToken = extractQueryParam(pathAndQuery, "token");
  const ticket = extractQueryParam(pathAndQuery, "ticket");

  if (legacyToken && !ticket) {
    socket.close(4004, "use_ws_ticket");
    return;
  }

  if (!ticket) {
    socket.close(4001, "missing ticket");
    return;
  }

  if (!(await assertWsConnectThrottleAllowed(clientIp))) {
    log.warn(
      { event: "ws_connect_throttled", reason: "reconnect_window" },
      "ws connect throttled"
    );
    socket.close(4029, "rate limited");
    return;
  }

  const active = await registerWsConnectionActive(clientIp);
  if (!active.ok) {
    log.warn(
      { event: "ws_connect_throttled", reason: "concurrent_limit" },
      "ws concurrent limit"
    );
    socket.close(4028, "too many connections");
    return;
  }

  const userId = await consumeWsTicket(ticket);
  if (!userId) {
    releaseWsConnectionActive(clientIp);
    socket.close(4006, "invalid or expired ticket");
    return;
  }

  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    releaseWsConnectionActive(clientIp);
    socket.close(4005, "user not found");
    return;
  }

  if (await isUserBanned(userId)) {
    releaseWsConnectionActive(clientIp);
    socket.close(4003, "banned");
    return;
  }

  let releasedActive = false;
  const releaseOnce = () => {
    if (releasedActive) return;
    releasedActive = true;
    releaseWsConnectionActive(clientIp);
  };
  socket.once("close", releaseOnce);
  socket.once("error", releaseOnce);

  trackSocket(userId, socket);

  try {
    const initial = await buildWsInitialState(userId);
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(initial));
    }
  } catch {
    /* ignore: клиент всё равно может подтянуть REST */
  }
}
