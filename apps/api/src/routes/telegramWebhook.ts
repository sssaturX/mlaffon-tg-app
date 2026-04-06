import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { telegramBotApi } from "../services/telegramApi.js";
import {
  setLiveNotifySubscriberActive,
  upsertLiveNotifySubscriber,
} from "../services/telegramLiveSubscribers.js";

const updateSchema = z
  .object({
    update_id: z.number(),
    message: z
      .object({
        message_id: z.number(),
        chat: z.object({
          id: z.number(),
          type: z.string(),
        }),
        from: z.object({ id: z.number() }).optional(),
        text: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

function commandFromText(text: string | undefined): "start" | "stop" | null {
  if (!text) return null;
  const t = text.trim();
  if (t === "/start" || t.startsWith("/start ")) return "start";
  if (t === "/stop") return "stop";
  return null;
}

const WELCOME_HTML =
  "Привет! Ты подписан на уведомления о стриме — когда эфир начнётся, пришлю сообщение с кнопкой " +
  "<b>Открыть приложение</b> и ссылкой на трансляцию.\n\n" +
  "/stop — отключить уведомления";

const STOP_HTML = "Уведомления о стриме отключены. Напиши /start, если снова захочешь их получать.";

export async function registerTelegramWebhookRoutes(app: FastifyInstance) {
  app.post("/api/v1/telegram/webhook", async (req, reply) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!secret || !token) {
      return reply.status(503).send({ ok: false });
    }

    const hdr = req.headers["x-telegram-bot-api-secret-token"];
    if (typeof hdr !== "string" || hdr !== secret) {
      return reply.status(401).send({ ok: false });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.send({ ok: true });
    }

    const msg = parsed.data.message;
    if (!msg || msg.chat.type !== "private") {
      return reply.send({ ok: true });
    }

    const fromId = msg.from?.id ?? msg.chat.id;
    const chatId = BigInt(msg.chat.id);
    const userId = BigInt(fromId);

    const cmd = commandFromText(msg.text);
    if (cmd === "start") {
      await upsertLiveNotifySubscriber({
        telegramUserId: userId,
        chatId,
      });
      void telegramBotApi("sendMessage", {
        chat_id: String(chatId),
        text: WELCOME_HTML,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } else if (cmd === "stop") {
      await setLiveNotifySubscriberActive(userId, false);
      void telegramBotApi("sendMessage", {
        chat_id: String(chatId),
        text: STOP_HTML,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }

    return reply.send({ ok: true });
  });
}
