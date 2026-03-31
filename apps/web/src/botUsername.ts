/** Имя бота в Telegram без @; совпадает с прод-ботом, если VITE_BOT_USERNAME не задан при сборке. */
const DEFAULT_BOT_USERNAME = "MlaffonBot";

export function getBotUsername(): string {
  const v = import.meta.env.VITE_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";
  return v || DEFAULT_BOT_USERNAME;
}
