import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://mlaffon:mlaffon@localhost:5432/mlaffon";

const pool = new pg.Pool({ connectionString });

export const db = drizzle(pool, { schema });
export { schema };

/**
 * После `docker compose down -v` Postgres поднимается с пустым томом и несколько секунд
 * не принимает коннекты; API на хосте (systemd) часто стартует раньше → 500 на первых запросах.
 * Ждём живой пул перед listen.
 */
export async function waitForDatabaseReady(): Promise<void> {
  const maxMs = Number(process.env.DB_WAIT_MAX_MS ?? 120_000);
  const intervalMs = Number(process.env.DB_WAIT_INTERVAL_MS ?? 500);
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < maxMs) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  const msg =
    lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `Database not reachable after ${maxMs}ms (${msg}). ` +
      `Убедитесь, что Postgres запущен (docker compose up -d) и DATABASE_URL верный.`
  );
}
