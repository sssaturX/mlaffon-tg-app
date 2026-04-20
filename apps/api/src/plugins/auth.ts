import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { verifySession } from "../lib/jwt.js";
import { markRequestTrace } from "../lib/requestTrace.js";
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
    /** WS: одноразовый `ticket` в query; Bearer не используется на upgrade. */
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
      markRequestTrace(req, "auth_skip_no_bearer");
      return;
    }
    const token = auth.slice(7);
    try {
      const p = verifySession(token);
      req.userId = p.sub;
      markRequestTrace(req, "jwt_verified");
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
        markRequestTrace(req, "db_user_lookup");
        if (!u) {
          req.userId = undefined;
          void reply.status(401).send({
            error: {
              code: "session_invalid",
              message: "Сессия устарела. Войдите снова.",
            },
          });
          return;
        }
      } catch {
        req.userId = undefined;
        void reply.status(503).send({
          error: {
            code: "service_unavailable",
            message: "Сервис временно недоступен. Попробуйте позже.",
          },
        });
        return;
      }
      try {
        if (await isUserBanned(req.userId)) {
          const allowedWhenBanned =
            path === "/api/v1/me" ||
            path === "/api/v1/me/profile" ||
            path === "/api/v1/me/economy" ||
            path === "/api/v1/ban-appeal";
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
        req.userId = undefined;
        void reply.status(503).send({
          error: {
            code: "service_unavailable",
            message: "Сервис временно недоступен. Попробуйте позже.",
          },
        });
        return;
      }
      markRequestTrace(req, "auth_complete");
    }
  });
}

export function authUser(
  req: FastifyRequest,
  reply: FastifyReply
): string | undefined {
  if (!req.userId) {
    void reply
      .header("Cache-Control", "private, no-store, no-cache, must-revalidate")
      .status(401)
      .send({
        error: { code: "unauthorized", message: "Войдите снова." },
      });
    return undefined;
  }
  return req.userId;
}
