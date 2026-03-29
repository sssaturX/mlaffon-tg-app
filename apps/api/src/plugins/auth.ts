import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifySession } from "../lib/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export async function registerAuth(app: FastifyInstance) {
  app.addHook("preHandler", async (req: FastifyRequest) => {
    const path = req.url.split("?")[0] ?? "";
    if (path === "/health") return;
    if (path === "/api/v1/auth/telegram") return;
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
