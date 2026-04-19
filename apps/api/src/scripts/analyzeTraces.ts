/**
 * TRACE-DRIVEN ROOT CAUSE RESOLVER (offline).
 *
 * Reads JSONL logs (journalctl -o json OR app logs with JSON per line),
 * extracts events: slow_api_request, request_trace, event_loop_lag, pg_pool_waiting,
 * correlates by time, and classifies slow requests into one bucket:
 * AUTH / HANDLER / CPU / INFRA / DB.
 *
 * Usage (from apps/api):
 *   npx tsx src/scripts/analyzeTraces.ts /path/to/log.jsonl
 *
 * Tips (on server):
 *   journalctl -u mlaffon-api --since "1 hour ago" -o json > /tmp/api.jsonl
 *   npx tsx src/scripts/analyzeTraces.ts /tmp/api.jsonl
 */
import { readFile } from "node:fs/promises";

type AnyObj = Record<string, unknown>;

type RequestRow = {
  tsMs: number;
  level?: string;
  msg?: string;
  url?: string;
  method?: string;
  ms?: number;
  contentLength?: unknown;
  handlerApproxMs?: number;
  requestTraceMs?: Record<string, number>;
};

type EventLoopRow = { tsMs: number; meanMs: number; maxMs: number };
type PgPoolRow = { tsMs: number; waiting: number; idle?: number; total?: number };

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseTimestampMs(o: AnyObj): number | null {
  // journalctl json: __REALTIME_TIMESTAMP is microseconds since epoch (string)
  const rt = o["__REALTIME_TIMESTAMP"];
  if (typeof rt === "string" && /^\d+$/.test(rt)) {
    const us = Number(rt);
    if (Number.isFinite(us)) return Math.floor(us / 1000);
  }
  // common structured logs: time / ts / timestamp as ISO string
  const iso =
    (typeof o["time"] === "string" && o["time"]) ||
    (typeof o["timestamp"] === "string" && o["timestamp"]) ||
    (typeof o["ts"] === "string" && o["ts"]) ||
    null;
  if (iso) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function getMsg(o: AnyObj): string | undefined {
  const m = o["msg"] ?? o["message"];
  return typeof m === "string" ? m : undefined;
}

function findNumberIn(o: AnyObj, key: string): number | null {
  const v = o[key];
  return asNum(v);
}

function normalizeUrl(u: unknown): string | undefined {
  if (typeof u !== "string") return undefined;
  return u.split("?")[0] ?? u;
}

function classify(r: RequestRow, nearCpu: EventLoopRow | null, nearPg: PgPoolRow | null): {
  bucket: "AUTH" | "HANDLER" | "CPU" | "INFRA" | "DB";
  reason: string;
} {
  const total = r.ms ?? 0;
  const t = r.requestTraceMs ?? {};
  const authComplete = t["auth_complete"];
  const jwt = t["jwt_verified"];
  const dbUser = t["db_user_lookup"];

  // Silent gap heuristic: very few marks and huge elapsed.
  const markCount = Object.keys(t).length;
  if (total >= 10_000 && markCount <= 1) {
    return { bucket: "INFRA", reason: `silent_gap marks=${markCount}` };
  }

  // CPU if lag correlates and is high.
  if (nearCpu && (nearCpu.meanMs >= 100 || nearCpu.maxMs >= 200)) {
    return { bucket: "CPU", reason: `event_loop_lag mean=${nearCpu.meanMs} max=${nearCpu.maxMs}` };
  }

  // AUTH delay: auth_complete late or jwt/db_user late.
  if (authComplete != null && authComplete >= 1000) {
    return { bucket: "AUTH", reason: `auth_complete=${authComplete}ms` };
  }
  if (jwt != null && jwt >= 500) {
    return { bucket: "AUTH", reason: `jwt_verified=${jwt}ms` };
  }
  if (dbUser != null && dbUser >= 800) {
    return { bucket: "AUTH", reason: `db_user_lookup=${dbUser}ms` };
  }

  // DB-bound: pool waiting observed near request time.
  if (nearPg && nearPg.waiting > 0) {
    return { bucket: "DB", reason: `pg_pool_waiting waiting=${nearPg.waiting}` };
  }

  // Handler delay: auth is fast but handlerApprox is large.
  if (r.handlerApproxMs != null && r.handlerApproxMs >= 1500) {
    return { bucket: "HANDLER", reason: `handlerApproxMs=${r.handlerApproxMs}` };
  }

  // Default: infra vs handler. If marks exist and auth done quickly -> handler.
  if (authComplete != null && authComplete < 500 && total >= 2000) {
    return { bucket: "HANDLER", reason: `auth_complete=${authComplete}ms total=${total}ms` };
  }
  return { bucket: "INFRA", reason: `fallback total=${total}ms marks=${markCount}` };
}

function nearestByTime<T extends { tsMs: number }>(arr: T[], tsMs: number, windowMs: number): T | null {
  // arr is in ascending time.
  let lo = 0;
  let hi = arr.length - 1;
  let best: T | null = null;
  let bestDelta = Infinity;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cur = arr[mid]!;
    const d = Math.abs(cur.tsMs - tsMs);
    if (d < bestDelta) {
      bestDelta = d;
      best = cur;
    }
    if (cur.tsMs < tsMs) lo = mid + 1;
    else hi = mid - 1;
  }
  if (best && bestDelta <= windowMs) return best;
  return null;
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx src/scripts/analyzeTraces.ts <log.jsonl>");
  process.exit(1);
}

const raw = await readFile(file, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);

const slow: RequestRow[] = [];
const traces: RequestRow[] = [];
const cpu: EventLoopRow[] = [];
const pg: PgPoolRow[] = [];

for (const line of lines) {
  let o: AnyObj;
  try {
    o = JSON.parse(line) as AnyObj;
  } catch {
    continue;
  }
  const tsMs = parseTimestampMs(o);
  if (tsMs == null) continue;

  const msg = getMsg(o);
  if (msg === "slow_api_request" || msg === "request_trace") {
    const row: RequestRow = {
      tsMs,
      level: typeof o["level"] === "string" ? (o["level"] as string) : undefined,
      msg,
      url: normalizeUrl(o["url"]),
      method: typeof o["method"] === "string" ? (o["method"] as string) : undefined,
      ms: findNumberIn(o, "ms") ?? undefined,
      contentLength: o["contentLength"],
      handlerApproxMs: asNum(o["handlerApproxMs"]) ?? undefined,
      requestTraceMs:
        o["requestTraceMs"] && typeof o["requestTraceMs"] === "object"
          ? (o["requestTraceMs"] as Record<string, number>)
          : undefined,
    };
    if (msg === "slow_api_request") slow.push(row);
    else traces.push(row);
    continue;
  }

  if (msg === "event_loop_lag") {
    const lag = o["eventLoopLag"];
    if (lag && typeof lag === "object") {
      const meanMs = asNum((lag as AnyObj)["meanMs"]);
      const maxMs = asNum((lag as AnyObj)["maxMs"]);
      if (meanMs != null && maxMs != null) cpu.push({ tsMs, meanMs, maxMs });
    }
    continue;
  }

  if (msg === "pg_pool_waiting") {
    const p = o["pgPool"];
    if (p && typeof p === "object") {
      const waiting = asNum((p as AnyObj)["waiting"]);
      const idle = asNum((p as AnyObj)["idle"]) ?? undefined;
      const total = asNum((p as AnyObj)["total"]) ?? undefined;
      if (waiting != null) pg.push({ tsMs, waiting, idle, total });
    }
    continue;
  }
}

slow.sort((a, b) => a.tsMs - b.tsMs);
traces.sort((a, b) => a.tsMs - b.tsMs);
cpu.sort((a, b) => a.tsMs - b.tsMs);
pg.sort((a, b) => a.tsMs - b.tsMs);

const windowMs = 10_000;

type Bucket = "AUTH" | "HANDLER" | "CPU" | "INFRA" | "DB";
const counts: Record<Bucket, number> = { AUTH: 0, HANDLER: 0, CPU: 0, INFRA: 0, DB: 0 };
const byUrl: Record<string, Record<Bucket, number>> = {};

const topExamples: Array<{ url?: string; ms?: number; bucket: Bucket; reason: string; trace?: Record<string, number> }> = [];

for (const r of slow) {
  const nearCpu = nearestByTime(cpu, r.tsMs, windowMs);
  const nearPg = nearestByTime(pg, r.tsMs, windowMs);
  const res = classify(r, nearCpu, nearPg);
  counts[res.bucket] += 1;
  const u = r.url ?? "<unknown>";
  byUrl[u] ??= { AUTH: 0, HANDLER: 0, CPU: 0, INFRA: 0, DB: 0 };
  byUrl[u]![res.bucket] += 1;
  if (topExamples.length < 15) {
    topExamples.push({ url: r.url, ms: r.ms, bucket: res.bucket, reason: res.reason, trace: r.requestTraceMs });
  }
}

console.log(
  JSON.stringify(
    {
      input: {
        lines: lines.length,
        slow: slow.length,
        traces: traces.length,
        cpu: cpu.length,
        pg: pg.length,
      },
      classification: { counts, byUrl },
      examples: topExamples,
    },
    null,
    2
  )
);

