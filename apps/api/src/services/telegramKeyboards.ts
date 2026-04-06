/**
 * Inline-кнопка «Открыть приложение» (Mini App) или ссылка на бота.
 */
export function buildMiniAppInlineKeyboard(): Array<
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
