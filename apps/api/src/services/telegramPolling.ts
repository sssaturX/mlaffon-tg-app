import type { FastifyBaseLogger } from "fastify";
import { processTelegramBotUpdate } from "./telegramBotUpdates.js";

/**
 * Без TELEGRAM_WEBHOOK_SECRET Telegram не шлёт апдейты на URL — тогда достаточно токена:
 * long polling getUpdates в этом процессе (один инстанс API на сервере).
 * Если задан секрет — используется только вебхук, polling не стартует.
 */
export function maybeStartTelegramLongPolling(
  log: FastifyBaseLogger,
  registerStop: (stop: () => void) => void
): void {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!token) return;
  if (secret) {
    log.info("telegram: режим вебхука (TELEGRAM_WEBHOOK_SECRET задан)");
    return;
  }

  log.info("telegram: long polling — /start без настройки вебхука");

  let running = true;
  registerStop(() => {
    running = false;
  });

  let offset = 0;

  void (async () => {
    try {
      const del = await fetch(
        `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`
      );
      const dj = (await del.json()) as { ok?: boolean; description?: string };
      if (dj.ok) {
        log.info("telegram: старый вебхук снят (deleteWebhook), включён long polling");
      } else {
        log.warn({ dj }, "telegram_delete_webhook");
      }
    } catch (e) {
      log.warn({ err: e }, "telegram_delete_webhook_failed");
    }
  })();

  const poll = async () => {
    while (running) {
      try {
        const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
        url.searchParams.set("timeout", "50");
        if (offset > 0) url.searchParams.set("offset", String(offset));

        const ac = new AbortController();
        const kill = setTimeout(() => ac.abort(), 120_000);
        const res = await fetch(url.toString(), { signal: ac.signal });
        clearTimeout(kill);

        const data = (await res.json()) as {
          ok?: boolean;
          result?: unknown[];
          description?: string;
        };
        if (!data.ok || !Array.isArray(data.result)) {
          log.warn({ data }, "telegram_getUpdates_bad");
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        for (const u of data.result) {
          const up = u as { update_id?: number };
          if (typeof up.update_id === "number") {
            offset = up.update_id + 1;
          }
          await processTelegramBotUpdate(u);
        }
      } catch (e) {
        if (!running) break;
        const aborted = e instanceof Error && e.name === "AbortError";
        if (!aborted) {
          log.warn({ err: e }, "telegram_polling_error");
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    log.info("telegram: long polling остановлен");
  };

  void poll();
}
