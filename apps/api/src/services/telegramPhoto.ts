import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * sendPhoto: URL (Telegram скачает сам) или multipart из локального файла.
 */
export async function telegramBotSendPhoto(params: {
  chatId: string;
  caption: string;
  parseMode?: "HTML";
  replyMarkup?: Record<string, unknown>;
  /** Публичный HTTPS URL картинки */
  photoUrl?: string;
  /** Локальный путь (например assets/… в каталоге apps/api при запуске оттуда) */
  photoPath?: string;
}): Promise<
  | { ok: true }
  | { ok: false; description: string; errorCode?: number }
> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, description: "no_token" };

  const url = `https://api.telegram.org/bot${token}/sendPhoto`;

  try {
    let res: Response;
    if (params.photoPath) {
      const buf = await readFile(params.photoPath);
      const form = new FormData();
      form.set("chat_id", params.chatId);
      form.set("caption", params.caption);
      if (params.parseMode) form.set("parse_mode", params.parseMode);
      if (params.replyMarkup) {
        form.set("reply_markup", JSON.stringify(params.replyMarkup));
      }
      form.set("photo", new Blob([buf]), "welcome.png");
      res = await fetch(url, { method: "POST", body: form });
    } else if (params.photoUrl) {
      const form = new FormData();
      form.set("chat_id", params.chatId);
      form.set("photo", params.photoUrl);
      form.set("caption", params.caption);
      if (params.parseMode) form.set("parse_mode", params.parseMode);
      if (params.replyMarkup) {
        form.set("reply_markup", JSON.stringify(params.replyMarkup));
      }
      res = await fetch(url, { method: "POST", body: form });
    } else {
      return { ok: false, description: "no_photo_source" };
    }

    const data = (await res.json()) as {
      ok?: boolean;
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
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      description: e instanceof Error ? e.message : "fetch_failed",
    };
  }
}

/**
 * Путь к welcome-картинке: TELEGRAM_WELCOME_PHOTO_FILE или assets/telegram-start-welcome.png от cwd.
 */
export function resolveWelcomePhotoPath(): string {
  const fromEnv = process.env.TELEGRAM_WELCOME_PHOTO_FILE?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), "assets", "telegram-start-welcome.png");
}
