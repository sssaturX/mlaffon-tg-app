import { z } from "zod";
import { telegramBotApi } from "./telegramApi.js";
import {
  setLiveNotifySubscriberActive,
  upsertLiveNotifySubscriber,
} from "./telegramLiveSubscribers.js";

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
        from: z
          .object({
            id: z.number(),
            username: z.string().optional(),
          })
          .optional(),
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

const STOP_HTML =
  "Уведомления о стриме отключены. Напиши /start, если снова захочешь их получать.";

/**
 * Один апдейт от Telegram (вебхук или getUpdates).
 */
export async function processTelegramBotUpdate(raw: unknown): Promise<void> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return;

  const msg = parsed.data.message;
  if (!msg || msg.chat.type !== "private") return;

  const fromId = msg.from?.id ?? msg.chat.id;
  const chatId = BigInt(msg.chat.id);
  const userId = BigInt(fromId);
  const username = msg.from?.username?.trim() || null;

  const cmd = commandFromText(msg.text);
  if (cmd === "start") {
    await upsertLiveNotifySubscriber({
      telegramUserId: userId,
      chatId,
      telegramUsername: username,
    });
    void telegramBotApi("sendMessage", {
      chat_id: String(chatId),
      text: WELCOME_HTML,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    return;
  }
  if (cmd === "stop") {
    await setLiveNotifySubscriberActive(userId, false);
    void telegramBotApi("sendMessage", {
      chat_id: String(chatId),
      text: STOP_HTML,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}
