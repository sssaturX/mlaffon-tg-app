# Dynamic GET routes — latency and observability

This document tracks **shop items**, **tasks**, and the **Games “config”** request (`GET /api/v1/games/fortune/config`): cache model, Prometheus metrics, and how to compare cold vs warm paths.

## Prometheus metrics (apps/api)

| Metric | Labels | Meaning |
|--------|--------|---------|
| `shop_items_http_seconds` | `platform` | Handler time for `GET /api/v1/shop/items` after auth preHandler (`authUser` + `getShopClientBundle`). |
| `shop_bundle_cache_total` | `result`, `platform` | Redis bundle: `hit` / `miss` per `twitch` / `kick`. |
| `shop_bundle_phase_seconds` | `platform`, `phase` | `redis_read`, `rebuild_db_parallel`, `cache_write`, `singleflight_worker` (only the worker coroutine), `total_inner` (every caller, incl. singleFlight waiters). |
| `tasks_http_seconds` | `platform` | `GET /api/v1/tasks` after auth. |
| `tasks_list_build_seconds` | `cache` | `hit`, `miss_revoke_warmed`, `miss_compute` — full `listTasksForUser`. |
| `tasks_list_cache_total` | `result` | User task list Redis: `hit` / `miss`. |
| `tasks_list_phase_seconds` | `phase` | `catalog_load`, `user_list_redis`, `revoke_external`, `user_list_after_revoke`, `compute`, `total_inner`. |
| `http_request_duration_seconds` | `method`, `route`, `status_code` | End-to-end HTTP (includes preHandler auth DB lookup). |

**Grafana-style queries:** use histogram `_sum` / `_count` for averages; `_bucket` for p95. For cache hit ratio: `rate(shop_bundle_cache_total{result="hit"}[5m]) / rate(shop_bundle_cache_total[5m])`.

## Shop: `GET /api/v1/shop/items`

- **Strategy:** Redis **final bundle per platform** (`items` + `globalCopy`), key prefix `mlaffon:shop:bundle:v2:{twitch|kick}`, TTL **180s**. Miss → `Promise.all(listShopItemsForClient, getShopGlobalCopyForClient)` → `setex` → return.
- **Invalidation:** `invalidateShopBundleCache()` on purchase, admin shop CRUD, global copy updates (see `shop.ts`, `adminShop.ts`, `shopSettings.ts`).
- **Warm path:** expect dominant `shop_bundle_phase_seconds` phase `redis_read` and small `total_inner`.
- **Slow log:** `[shop] slow getShopClientBundle` if inner build &gt; 500 ms.

## Tasks: `GET /api/v1/tasks`

- **Strategy A (current):** Full user task DTO list in Redis (`taskUserListCache`) checked **before** `runRevocationChecksBatched` so warm path avoids Helix/Kick.
- **Phases:** `catalog_load` = active tasks cache; `user_list_redis` = user DTO cache; on miss, `revoke_external` then optional `user_list_after_revoke` or `compute`.

## “config” in the browser waterfall

- **Identified URL:** `GET /api/v1/games/fortune/config`.
- **Previous bottleneck:** auth `preHandler` did JWT + **`users` table SELECT** + ban check on every `/api/v1/*` request with Bearer; handler itself is in-memory (`getFortuneConfigResponse`).
- **Change:** route is **skipped** in `plugins/auth.ts` (no DB for this path). Client may load config **without** waiting for token (`useFortuneConfig` always enabled).

## Before/after methodology

1. **Local:** `curl` to `127.0.0.1:<port>` with `Authorization` for shop/tasks; repeat for warm cache.
2. **Through origin:** same URL via public host — if local fast and origin slow, inspect TLS/proxy/TTFB.
3. **Compare** `http_request_duration_seconds` (full) vs `shop_items_http_seconds` / `tasks_http_seconds` (post-auth handler) to see preHandler overhead.

## Rollout

- Deploy API + web together for fortune config behavior (optional Bearer).
- Shop cache key bump `v1` → `v2` naturally cold-starts; no migration needed (old keys expire).

## See also

- [Browser Network timing capture](browser-network-timing-capture.md) — чеклист DevTools (Timing, waterfall, HAR) для разбора медленных запросов в UI.
- [Last-mile performance](last-mile-performance.md) — цепочка задержек (lazy, route transition), intent prefetch, preconnect/reuse.
- [Final performance report](final-performance-report.md) — единый отчёт для релиза; числа заполняются по [perf-baseline.md](perf-baseline.md).
