import type { FastifyInstance } from "fastify";
import { processTelegramBotUpdate } from "../services/telegramBotUpdates.js";

export async function registerTelegramWebhookRoutes(app: FastifyInstance) {
  app.post("/api/v1/telegram/webhook", async (req, reply) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!secret || !token) {
      return reply.status(404).send({ ok: false });
    }

    const hdr = req.headers["x-telegram-bot-api-secret-token"];
    if (typeof hdr !== "string" || hdr !== secret) {
      return reply.status(401).send({ ok: false });
    }

    await processTelegramBotUpdate(req.body);
    return reply.send({ ok: true });
  });
}
