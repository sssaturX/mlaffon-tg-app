import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { verifySession } from "../lib/jwt.js";
import { isUserBanned } from "../services/userBan.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export async function registerAuth(app: FastifyInstance) {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?")[0] ?? "";
    if (path === "/health") return;
    /** WS: JWT в query `token`, не в Authorization. */
    if (path === "/api/v1/ws") return;
    if (path === "/api/v1/auth/telegram") return;
    if (path === "/api/v1/auth/register") return;
    if (path === "/api/v1/auth/login") return;
    if (path === "/api/v1/auth/dev") return;
    if (path === "/api/v1/oauth/twitch/callback") return;
    if (path === "/api/v1/oauth/kick/callback") return;

    if (!path.startsWith("/api/v1")) return;

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      req.userId = undefined;
      return;
    }
    const token = auth.slice(7);
    try {
      const p = verifySession(token);
      req.userId = p.sub;
    } catch {
      req.userId = undefined;
    }

    if (req.userId) {
      try {
        const [u] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, req.userId))
          .limit(1);
        if (!u) {
          void reply.status(401).send({
            error: {
              code: "session_invalid",
              message: "Сессия устарела. Войдите снова.",
            },
          });
          return;
        }
      } catch {
        /* не блокируем при сбое БД — ниже проверка banned */
      }
      try {
        if (await isUserBanned(req.userId)) {
          const allowedWhenBanned =
            path === "/api/v1/me" || path === "/api/v1/ban-appeal";
          if (!allowedWhenBanned) {
            void reply.status(403).send({
              error: {
                code: "banned",
                message:
                  "Доступ к приложению ограничен. Если это ошибка — напишите в поддержку.",
              },
            });
            return;
          }
        }
      } catch {
        /* не блокируем запрос при сбое проверки БД */
      }
    }
  });
}

export function authUser(
  req: FastifyRequest,
  reply: FastifyReply
): string | undefined {
  if (!req.userId) {
    void reply.status(401).send({
      error: { code: "unauthorized", message: "Bearer token required" },
    });
    return undefined;
  }
  return req.userId;
}
