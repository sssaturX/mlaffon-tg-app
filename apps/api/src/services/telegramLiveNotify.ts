/**
 * Уведомление в Telegram при старте эфира (канал/группа или указанный chat_id).
 * Кнопка открывает мини-приложение (HTTPS URL из BotFather).
 */
export async function notifyTelegramLiveStarted(params: {
  platform: "twitch" | "kick";
  streamUrl: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_LIVE_NOTIFY_CHAT_ID?.trim();
  if (!token) return { ok: false, reason: "no_token" };
  if (!chatId) return { ok: false, reason: "no_chat_id" };

  const botUser = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim();
  const miniAppUrl = (
    process.env.MINI_APP_WEB_URL?.trim() ||
    process.env.PUBLIC_WEB_URL?.trim() ||
    ""
  ).replace(/\/$/, "");

  const plat = params.platform === "kick" ? "Kick" : "Twitch";
  const text =
    `🔴 Эфир начался (${plat})!\n\n` +
    `Заходите в приложение и нажмите «Смотреть стрим», чтобы засчитать стрик.\n\n` +
    `Ссылка: ${params.streamUrl}`;

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

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: false,
  };
  if (keyboard.length > 0) {
    body.reply_markup = { inline_keyboard: keyboard };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || data.ok !== true) {
      return {
        ok: false,
        reason: data.description ?? `http_${res.status}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "fetch_failed",
    };
  }
}
