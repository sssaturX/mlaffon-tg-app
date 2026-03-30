import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authUser } from "../plugins/auth.js";
import { attemptDropCode, getActiveDropSnapshot } from "../services/drops.js";

export async function registerDropRoutes(app: FastifyInstance) {
  app.get("/api/v1/drops/active", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    return getActiveDropSnapshot(userId);
  });

  const attemptBody = z.object({
    code: z.string().min(1),
  });

  app.post("/api/v1/drops/attempt", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const parsed = attemptBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const r = await attemptDropCode(userId, parsed.data.code);
    if (r.ok) {
      return { ok: true, reward: r.reward };
    }
    const status: Record<string, number> = {
      not_found: 404,
      drop_ended: 410,
      wrong_code: 400,
      already_won: 409,
      pool_full: 409,
      duplicate: 409,
    };
    const messages: Record<string, string> = {
      not_found: "Дроп не найден",
      drop_ended: "Дроп завершён",
      wrong_code: "Неверный код",
      already_won: "Награда уже получена",
      pool_full: "Лимит победителей исчерпан",
      duplicate: "Повторный запрос",
    };
    return reply.status(status[r.code] ?? 400).send({
      ok: false,
      error: r.code,
      message: messages[r.code] ?? r.code,
    });
  });
}
