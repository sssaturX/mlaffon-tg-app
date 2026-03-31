/**
 * Проверка членства в канале/супергруппе через Telegram Bot API getChatMember.
 * Бот должен быть администратором канала (или состоять в группе с правом видеть участников).
 */
export async function checkTelegramChannelMembership(
  telegramUserId: bigint,
  chatId: string
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId.trim()) return false;

  const url = new URL(`https://api.telegram.org/bot${token}/getChatMember`);
  url.searchParams.set("chat_id", chatId.trim());
  url.searchParams.set("user_id", String(telegramUserId));

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    const data = (await res.json()) as {
      ok?: boolean;
      result?: { status?: string };
      description?: string;
    };
    if (!data.ok || !data.result?.status) return false;
    const s = data.result.status;
    return (
      s === "creator" ||
      s === "administrator" ||
      s === "member" ||
      s === "restricted"
    );
  } catch {
    return false;
  }
}
