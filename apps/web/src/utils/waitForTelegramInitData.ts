import { TelegramWebApp as WebApp } from "../lib/telegramAdapter";

/** `start_param` из строки initData (startapp=… / привязка link_*). */
export function getStartParamFromInitData(initData: string): string | null {
  try {
    return new URLSearchParams(initData).get("start_param");
  } catch {
    return null;
  }
}

/** Есть ли признаки запуска внутри Telegram (initData может прийти на тик позже). */
export function looksLikeTelegramMiniApp(): boolean {
  try {
    const w = WebApp as {
      platform?: string;
      initDataUnsafe?: { user?: unknown } | null;
    };
    if (w.platform && w.platform !== "unknown") return true;
    if (w.initDataUnsafe?.user != null) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * В части WebView `initData` пустой на первом чтении и появляется через короткое время.
 * Без ожидания пользователь попадает на «Откройте в Telegram» или на ошибку входа.
 */
export function waitForTelegramInitData(
  maxMs = 2000,
  intervalMs = 50
): Promise<string | null> {
  const initial = WebApp.initData?.trim() ?? "";
  if (initial.length > 0) return Promise.resolve(initial);

  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const raw = WebApp.initData?.trim() ?? "";
      if (raw.length > 0) {
        resolve(raw);
        return;
      }
      if (Date.now() - start >= maxMs) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, intervalMs);
    };
    tick();
  });
}
