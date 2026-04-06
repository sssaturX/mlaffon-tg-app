import { stat } from "node:fs/promises";
import { z } from "zod";
import { telegramBotApi } from "./telegramApi.js";
import { buildMiniAppInlineKeyboard } from "./telegramKeyboards.js";
import {
  resolveWelcomePhotoPath,
  telegramBotSendPhoto,
} from "./telegramPhoto.js";
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
            first_name: z.string().optional(),
          })
          .optional(),
        text: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function commandFromText(
  text: string | undefined
): "start" | "stop" | "guide" | null {
  if (!text) return null;
  const t = text.trim();
  const lower = t.toLowerCase();
  if (lower === "/start" || lower.startsWith("/start ")) return "start";
  if (lower === "/stop") return "stop";
  if (lower === "/guide" || lower.startsWith("/guide ")) return "guide";
  return null;
}

function buildStartCaption(displayName: string): string {
  const name = escapeHtmlText(displayName);
  return (
    `Привет, <b>${name}</b>! 👋\n\n` +
    "🔥 Заходи на стримы <b>🟢 Kick</b> и <b>🟣 Twitch</b>, активничай и зарабатывай монеты\n" +
    "💰 Трать их в магазине на призы\n\n" +
    "📖 Команда /guide — если хочешь узнать больше\n\n" +
    "👇 Жми нужные кнопки и присоединяйся к нам"
  );
}

const STOP_HTML =
  "Уведомления о стриме отключены. Напиши /start, если снова захочешь их получать.";

const DEFAULT_GUIDE_TELEGRAPH_URL = "https://telegra.ph/Guide-04-06-25";
const DEFAULT_SUPPORT_URL = "https://t.me/MLAFFsupport";

function buildGuideText(): string {
  const guideUrl =
    process.env.TELEGRAM_GUIDE_TELEGRAPH_URL?.trim() ||
    DEFAULT_GUIDE_TELEGRAPH_URL;
  const supportUrl =
    process.env.TELEGRAM_SUPPORT_URL?.trim() || DEFAULT_SUPPORT_URL;
  return (
    `📖 Полный гайд по приложению:\n${guideUrl}\n\n` +
    `💬 Поддержка:\n${supportUrl}`
  );
}

async function sendWelcomeToChat(chatId: string, displayName: string): Promise<void> {
  const caption = buildStartCaption(displayName);
  const keyboard = buildMiniAppInlineKeyboard();
  const replyMarkup =
    keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;

  const photoUrl = process.env.TELEGRAM_WELCOME_PHOTO_URL?.trim();
  if (photoUrl && photoUrl.startsWith("https://")) {
    const r = await telegramBotSendPhoto({
      chatId,
      caption,
      parseMode: "HTML",
      replyMarkup,
      photoUrl,
    });
    if (r.ok) return;
  }

  const localPath = resolveWelcomePhotoPath();
  try {
    await stat(localPath);
    const r = await telegramBotSendPhoto({
      chatId,
      caption,
      parseMode: "HTML",
      replyMarkup,
      photoPath: localPath,
    });
    if (r.ok) return;
  } catch {
    /* нет файла */
  }

  void telegramBotApi("sendMessage", {
    chat_id: chatId,
    text: caption,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/**
 * Один апдейт от Telegram (вебхук или getUpdates).
 */
export async function processTelegramBotUpdate(raw: unknown): Promise<void> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return;

  const msg = parsed.data.message;
  if (!msg || msg.chat.type !== "private") return;

  const fromId = msg.from?.id ?? msg.chat.id;
  const chatId = String(msg.chat.id);
  const userId = BigInt(fromId);
  const username = msg.from?.username?.trim() || null;
  const firstName = msg.from?.first_name?.trim() || "";
  const displayName =
    firstName ||
    (username ? `@${username}` : "друг");

  const cmd = commandFromText(msg.text);
  if (cmd === "start") {
    await upsertLiveNotifySubscriber({
      telegramUserId: userId,
      chatId: BigInt(msg.chat.id),
      telegramUsername: username,
    });
    void sendWelcomeToChat(chatId, displayName);
    return;
  }
  if (cmd === "stop") {
    await setLiveNotifySubscriberActive(userId, false);
    void telegramBotApi("sendMessage", {
      chat_id: chatId,
      text: STOP_HTML,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    return;
  }
  if (cmd === "guide") {
    void telegramBotApi("sendMessage", {
      chat_id: chatId,
      text: buildGuideText(),
      disable_web_page_preview: true,
    });
  }
}
