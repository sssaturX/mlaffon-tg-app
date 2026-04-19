import { monitorEventLoopDelay } from "node:perf_hooks";
import type { FastifyBaseLogger } from "fastify";

/**
 * Лаг event loop (блокировки sync CPU / тяжёлый JSON).
 * Порог CRITICAL: EVENT_LOOP_LAG_WARN_MS (по умолчанию 100).
 * Интервал: EVENT_LOOP_MONITOR_MS (по умолчанию 0 = выкл).
 */
export function startEventLoopMonitor(log: FastifyBaseLogger): () => void {
  const intervalMs = Number.parseInt(process.env.EVENT_LOOP_MONITOR_MS ?? "0", 10);
  const warnMs = Number.parseInt(process.env.EVENT_LOOP_LAG_WARN_MS ?? "100", 10);
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
    return () => {};
  }

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  const id = setInterval(() => {
    const meanNs = histogram.mean;
    const maxNs = histogram.max;
    histogram.reset();
    const meanMs = meanNs / 1e6;
    const maxMs = maxNs / 1e6;
    if (meanMs >= warnMs || maxMs >= warnMs * 2) {
      log.warn(
        {
          eventLoopLag: {
            meanMs: Math.round(meanMs * 10) / 10,
            maxMs: Math.round(maxMs * 10) / 10,
          },
        },
        "event_loop_lag"
      );
    }
  }, intervalMs);

  return () => {
    clearInterval(id);
    histogram.disable();
  };
}
