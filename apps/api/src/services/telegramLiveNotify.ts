import { telegramBotApi } from "./telegramApi.js";
import {
  deactivateLiveNotifyByChatId,
  listActiveLiveNotifyChatIds,
} from "./telegramLiveSubscribers.js";

function escapeHtmlHref(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function buildLiveStartedHtml(params: {
  platform: "twitch" | "kick";
  streamUrl: string;
}): string {
  const platLabel = params.platform === "kick" ? "Kick" : "Twitch";
  const href = escapeHtmlHref(params.streamUrl.trim());
  return (
    "🔴 <b>Эфир начался!</b>\n\n" +
    "Заходите на стрим: откройте приложение и нажмите «Смотреть стрим», чтобы засчитался стрик.\n\n" +
    `📺 <a href="${href}">Смотреть на ${platLabel}</a>`
  );
}

function buildInlineKeyboard(): Array<
  Array<{ text: string; web_app?: { url: string }; url?: string }>
> {
  const botUser = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim();
  const miniAppUrl = (
    process.env.MINI_APP_WEB_URL?.trim() ||
    process.env.PUBLIC_WEB_URL?.trim() ||
    ""
  ).replace(/\/$/, "");

  const keyboard: Array<
    Array<{ text: string; web_app?: { url: string }; url?: string }>
  > = [];

  if (miniAppUrl.startsWith("https://")) {
    keyboard.push([
      { text: "Открыть приложение", web_app: { url: miniAppUrl } },
    ]);
  } else if (botUser) {
    keyboard.push([
      {
        text: "Открыть бота",
        url: `https://t.me/${botUser}`,
      },
    ]);
  }
  return keyboard;
}

async function sendLiveStartedToChat(params: {
  chatId: string | bigint;
  platform: "twitch" | "kick";
  streamUrl: string;
}): Promise<{ ok: true } | { ok: false; blocked?: boolean }> {
  const text = buildLiveStartedHtml(params);
  const keyboard = buildInlineKeyboard();

  const body: Record<string, unknown> = {
    chat_id: typeof params.chatId === "bigint" ? String(params.chatId) : params.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (keyboard.length > 0) {
    body.reply_markup = { inline_keyboard: keyboard };
  }

  const r = await telegramBotApi("sendMessage", body);
  if (r.ok) return { ok: true };

  if (r.errorCode === 403 && typeof params.chatId === "bigint") {
    await deactivateLiveNotifyByChatId(params.chatId);
    return { ok: false, blocked: true };
  }
  return { ok: false };
}

const BROADCAST_DELAY_MS = 40;

/**
 * Уведомление при старте эфира из админки:
 * — всем, кто нажал /start в личке с ботом (см. вебхук);
 * — опционально в чат `TELEGRAM_LIVE_NOTIFY_CHAT_ID` (канал/группа).
 */
export async function notifyTelegramLiveStarted(params: {
  platform: "twitch" | "kick";
  streamUrl: string;
}): Promise<
  | { ok: true; sent: number; failed: number }
  | { ok: false; reason: string }
> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, reason: "no_token" };

  const channelId = process.env.TELEGRAM_LIVE_NOTIFY_CHAT_ID?.trim();
  let subscriberChatIds: bigint[] = [];

  try {
    subscriberChatIds = await listActiveLiveNotifyChatIds();
  } catch {
    return { ok: false, reason: "db_subscribers" };
  }

  const privateTargets = [
    ...new Set(subscriberChatIds.map((id) => id.toString())),
  ].map((s) => BigInt(s));

  const targets: Array<string | bigint> = [...privateTargets];
  if (channelId) {
    targets.push(channelId);
  }

  if (targets.length === 0) {
    return { ok: false, reason: "no_recipients" };
  }

  let sent = 0;
  let failed = 0;

  for (const chatId of targets) {
    const r = await sendLiveStartedToChat({
      chatId,
      platform: params.platform,
      streamUrl: params.streamUrl,
    });
    if (r.ok) sent += 1;
    else failed += 1;
    await new Promise((resolve) => setTimeout(resolve, BROADCAST_DELAY_MS));
  }

  return { ok: true, sent, failed };
}
