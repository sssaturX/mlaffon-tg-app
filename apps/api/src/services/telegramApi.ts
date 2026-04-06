/**
 * Общие вызовы Telegram Bot API (sendMessage и т.д.).
 */
export async function telegramBotApi<T = unknown>(
  method: string,
  body: Record<string, unknown>
): Promise<
  | { ok: true; result: T }
  | { ok: false; description: string; errorCode?: number }
> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, description: "no_token" };

  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    };
    if (!data.ok) {
      return {
        ok: false,
        description: data.description ?? `http_${res.status}`,
        errorCode: data.error_code,
      };
    }
    return { ok: true, result: data.result as T };
  } catch (e) {
    return {
      ok: false,
      description: e instanceof Error ? e.message : "fetch_failed",
    };
  }
}
