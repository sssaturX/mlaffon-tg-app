import client from "prom-client";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register],
});

export const cacheHits = new client.Counter({
  name: "cache_hits_total",
  help: "Cache hit count",
  labelNames: ["cache_name"] as const,
  registers: [register],
});

export const cacheMisses = new client.Counter({
  name: "cache_misses_total",
  help: "Cache miss count",
  labelNames: ["cache_name"] as const,
  registers: [register],
});

export const dbPoolGauge = new client.Gauge({
  name: "db_pool_connections",
  help: "Database pool connection counts",
  labelNames: ["state"] as const,
  registers: [register],
});

export const queueDepthGauge = new client.Gauge({
  name: "bullmq_queue_depth",
  help: "BullMQ queue depth",
  labelNames: ["queue", "state"] as const,
  registers: [register],
});

export const jobDuration = new client.Histogram({
  name: "bullmq_job_duration_seconds",
  help: "Duration of BullMQ job processing",
  labelNames: ["queue", "job_name"] as const,
  buckets: [0.05, 0.1, 0.5, 1, 5, 30, 60],
  registers: [register],
});

/** GET /api/v1/tasks — полное время сборки списка (внутри listTasksForUser). */
export const tasksListBuildSeconds = new client.Histogram({
  name: "tasks_list_build_seconds",
  help: "Duration of listTasksForUser (Redis + DB + DTO)",
  labelNames: ["cache"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const tasksListCacheOutcome = new client.Counter({
  name: "tasks_list_cache_total",
  help: "Redis user task list cache hit/miss",
  labelNames: ["result"] as const,
  registers: [register],
});

/** Полный HTTP handler GET /tasks (после auth). */
export const tasksHttpSeconds = new client.Histogram({
  name: "tasks_http_seconds",
  help: "GET /api/v1/tasks total time after auth",
  labelNames: ["platform"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/** Фазы внутри listTasksForUser: каталог Redis/БД, user list Redis, revoke, compute. */
export const tasksListPhaseSeconds = new client.Histogram({
  name: "tasks_list_phase_seconds",
  help: "Phases inside listTasksForUser (catalog, caches, revoke, compute)",
  labelNames: ["phase"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/** GET /api/v1/shop/items: время handler после preHandler (authUser + bundle). */
export const shopItemsHttpSeconds = new client.Histogram({
  name: "shop_items_http_seconds",
  help: "GET /api/v1/shop/items handler time (after auth preHandler)",
  labelNames: ["platform"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const shopBundleCacheTotal = new client.Counter({
  name: "shop_bundle_cache_total",
  help: "Shop per-platform Redis bundle hit/miss",
  labelNames: ["result", "platform"] as const,
  registers: [register],
});

/** Фазы getShopClientBundle: redis_read, rebuild (DB parallel), cache_write, total_inner. */
export const shopBundlePhaseSeconds = new client.Histogram({
  name: "shop_bundle_phase_seconds",
  help: "Shop bundle build phases (Redis read, DB rebuild, cache set)",
  labelNames: ["platform", "phase"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

function normalizeRoute(req: FastifyRequest): string {
  const ctx = req.routeOptions;
  if (ctx?.url) return ctx.url;
  const url = req.url.split("?")[0] ?? req.url;
  return url.replace(/\/[0-9a-f-]{36}/g, "/:id").replace(/\/\d+/g, "/:id");
}

export function registerMetricsHooks(app: FastifyInstance): void {
  app.addHook("onResponse", (req: FastifyRequest, reply: FastifyReply, done) => {
    const route = normalizeRoute(req);
    const method = req.method;
    const statusCode = String(reply.statusCode);
    const duration = reply.elapsedTime / 1000;

    httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);
    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    done();
  });
}

export function registerMetricsEndpoint(app: FastifyInstance): void {
  app.get("/metrics", async (req, reply) => {
    const authKey = process.env.METRICS_AUTH_KEY?.trim();
    if (authKey) {
      const provided = (req.query as { key?: string }).key;
      if (provided !== authKey) {
        return reply.status(403).send("Forbidden");
      }
    }
    void reply.header("Content-Type", register.contentType);
    return register.metrics();
  });
}

export { register };
