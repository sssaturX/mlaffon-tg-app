import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authUser } from "../plugins/auth.js";
import { gameConfig } from "../config.js";
import { getActivePrediction, placePredictionBet } from "../services/predictions.js";

export async function registerPredictionRoutes(app: FastifyInstance) {
  app.get("/api/v1/predictions/active", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const prediction = await getActivePrediction(userId);
    return { prediction };
  });

  const betBody = z.object({
    option: z.enum(["A", "B"]),
    amount: z.number().int().min(1),
  });

  app.post(
    "/api/v1/predictions/:id/bet",
    {
      config: {
        rateLimit: {
          max: gameConfig.routeRateLimits.predictionBet.max,
          timeWindow: gameConfig.routeRateLimits.predictionBet.timeWindowMs,
        },
      },
    },
    async (req, reply) => {
      const userId = authUser(req, reply);
      if (!userId) return;
      const predictionId = (req.params as { id: string }).id;
      const parsed = betBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "bad_request", message: "Выберите исход и сумму ставки." },
        });
      }
      const r = await placePredictionBet({
        predictionId,
        userId,
        option: parsed.data.option,
        amount: parsed.data.amount,
      });
      if (!r.ok) {
        const status: Record<typeof r.code, number> = {
          not_found: 404,
          not_active: 409,
          already_bet: 409,
          insufficient_balance: 400,
          platform_inactive: 409,
        };
        const messages: Record<typeof r.code, string> = {
          not_found: "Предикт не найден",
          not_active: "Предикт сейчас не принимает ставки",
          already_bet: "Вы уже сделали ставку в этом предикте",
          insufficient_balance: "Недостаточно баланса на выбранной платформе",
          platform_inactive: "Платформа предикта отключена администратором",
        };
        return reply.status(status[r.code]).send({
          error: { code: r.code, message: messages[r.code] },
        });
      }
      return { ok: true, prediction: r.prediction };
    }
  );
}
