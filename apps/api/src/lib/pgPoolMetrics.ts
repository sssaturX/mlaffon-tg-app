import type { FastifyBaseLogger } from "fastify";
import { pool } from "../db/index.js";

/**
 * Периодический лог при ожидании коннекта из пула (pool waiting > 0).
 * Включить: PG_POOL_METRICS_MS=30000
 */
export function startPgPoolMetrics(log: FastifyBaseLogger): () => void {
  const ms = Number.parseInt(process.env.PG_POOL_METRICS_MS ?? "0", 10);
  if (!Number.isFinite(ms) || ms < 5000) {
    return () => {};
  }
  const tick = (): void => {
    const p = pool as unknown as {
      totalCount?: number;
      idleCount?: number;
      waitingCount?: number;
    };
    const waiting = p.waitingCount ?? 0;
    if (waiting > 0) {
      log.warn(
        {
          pgPool: {
            total: p.totalCount,
            idle: p.idleCount,
            waiting,
          },
        },
        "pg_pool_waiting"
      );
    }
  };
  const id = setInterval(tick, ms);
  return () => clearInterval(id);
}
