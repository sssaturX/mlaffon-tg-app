# AI AGENT TASK — ROOT CAUSE ANALYSIS + SCALABLE ARCHITECTURE (PRODUCTION INCIDENT)

## PROJECT

**`mlaffon-tg-app`** — монорепо:

- **`apps/api`** — Fastify  
- **Drizzle ORM** + **PostgreSQL**  
- **Redis** (ioredis)  
- **BullMQ** (очереди уже есть: `apps/api/src/queue/bullmq.ts`)

---

## OBJECTIVE

Агент должен:

1. Найти **реальные** причины latency spikes (вплоть до **60+ с**).  
2. **Подтвердить** их через измерения (**не** догадки).  
3. Устранить bottlenecks на уровне **архитектуры и инфраструктуры**, где это доказано данными.  
4. Довести систему (в целевом окружении) до:  
   - **p95 &lt; 500 ms** (healthy state);  
   - **отсутствие запросов &gt; 2 s** как нормы при обычной нагрузке.  
5. Подготовить **масштабируемую** production architecture и план миграции **без ломки** контрактов API.

---

## CRITICAL CONTEXT — OBSERVED SYMPTOMS

| Endpoint | Симптом (пример) | Путь в коде |
|----------|------------------|-------------|
| `GET /api/v1/shop/items` | до 60–70 s | `shop.ts` → `getShopClientBundle` → `shopBundleCache` |
| `GET /api/v1/tasks` | 10–20 s | `tasks.ts` → `listTasksForUser` → `taskCatalogCache` / `taskUserListCache` |
| `GET /api/v1/me/economy` | 5–10 s нестабильно | `me.ts` → `buildMeEconomyResponse` |
| `POST /api/v1/ws-ticket` | ~14 s | `wsTicket.ts` → Redis `SET` |

### KEY ASSUMPTION (ОБЯЗАТЕЛЬНО УЧЕСТЬ)

**60 s latency почти никогда не объясняется одним «медленным SQL на маленькой таблице».**  
Чаще это: **таймауты**, **истощение пула соединений**, **блокировки на уровне прокси/сети**, **очередь на Redis**, **cold infrastructure**.

---

## RULES OF INVESTIGATION (STRICT)

### FORBIDDEN

- Оптимизация «на глаз» без измерений.  
- Формулировки вроде «probably DB is slow» / «maybe cache» без proof.  
- Дублирование уже существующих кэшей без анализа инвалидации и ключей.

### REQUIRED

Каждый вывод по root cause сопровождать **хотя бы одним** из:

- логи (`slow_api_request`, Postgres, Redis);  
- метрики / тайминги;  
- `EXPLAIN (ANALYZE, BUFFERS)`;  
- воспроизводимый сценарий (один trace, `curl -w`, k6 с разбивкой).

---

# PHASE 1 — ROOT CAUSE ANALYSIS

## 1. Network / infra timeouts

Проверить:

- TCP connect timeouts к **Postgres**, **Redis**, внешним вызовам; типичные **~60 s** на уровне ОС/сети.  
- Cross-region: где API, где БД, где Redis.  
- Прокси (**Caddy** и т.д.): upstream queueing, таймауты к `127.0.0.1:3001`.

**Валидация:** `API_SLOW_REQUEST_MS` + логи `slow_api_request` (`apps/api/src/index.ts`), `log_min_duration_statement` в Postgres, Redis `INFO` / `LATENCY DOCTOR`, e2e один запрос с замером фаз (`curl -w`, trace).

## 2. PostgreSQL connection pool exhaustion

Проверить:

- `apps/api/src/db/index.ts` — `pg.Pool`: явные ли **`max`**, **`connectionTimeoutMillis`**, **`idleTimeoutMillis`** (по умолчанию **max ≈ 10**).  
- Гипотеза: запросы **не медленные сами по себе**, а **ждут** свободный коннект из пула.

**Измерить:** active/idle/waiting (события пула, обёртка, или метрики приложения).

## 3. Redis multi-client contention

Проверить:

- `apps/api/src/lib/redis.ts` — общий клиент.  
- `apps/api/src/queue/bullmq.ts` — **отдельный** ioredis для BullMQ.

Риски: **maxclients**, разные URL/DB index, лишние коннекты, очередь на установление соединения.

## 4. Cache stampede

Проверить:

- burst промахов кэша и **одновременный** прогрев одного ключа;  
- отсутствие **single-flight** (lock per key, `SET NX`);  
- отсутствие **SWR** там, где допустимо.

Объекты проверки: `listTasksForUser`, витрина `getShopClientBundle`, при необходимости агрегации economy.

## 5. Request blocking inside HTTP lifecycle

Проверить:

- синхронный тяжёлый CPU;  
- раздувание JSON (большие `imageMedia` в ответах);  
- скрытые **последовательные** `await` там, где можно объединить.

## 6. Database query analysis

Для критичных путей:

- `EXPLAIN (ANALYZE, BUFFERS)`;  
- full table scans, missing indexes, N+1, **OFFSET** на больших выборках (предпочтение cursor pagination где уместно).

Сверка с `apps/api/src/db/schema.ts` и фактическими миграциями.

---

# PHASE 2 — TARGET ARCHITECTURE DESIGN

## Целевая схема

```text
Client
  ↓
CDN (static assets, media)
  ↓
API Gateway / edge (rate limit; лёгкий auth — по возможности)
  ↓
Fastify API (thin orchestration)
  ↓
Redis (cache + sessions + locks / single-flight)
  ↓
PostgreSQL (optimized reads)
  ↓
BullMQ workers (heavy compute только где допустимо async)
```

## Принципы

1. **API thin:** в основном cache check → минимальные чтения БД → при необходимости enqueue в BullMQ.  
2. **Тяжёлое в workers:** пересчёты, аналитика, дорогие трансформации — не в том же event loop без лимитов.  
3. **Кэш:** SWR где безопасно + **single-flight** на ключ при промахе.  
4. **Request coalescing:** дедупликация in-flight вычислений одного ключа.  
5. **Postgres:** composite indexes, планы запросов, без неограниченных выборок.

---

## OBSERVABILITY (must implement plan)

В плане внедрения указать:

- p50 / p95 / p99 (хотя бы p95) по endpoint;  
- разбивка по этапам (опционально OpenTelemetry);  
- cache hit ratio (оценка или счётчики);  
- длительность SQL (slow query log / APM);  
- Redis latency / ошибки;  
- backlog очередей BullMQ.

## LOAD TEST

- **50+** concurrent users, **смешанный** сценарий: shop / tasks / economy / ws-ticket.  
- **PASS (ориентир):** p95 &lt; 500 ms в healthy окружении; нет «нормы» &gt; 2 s; error rate &lt; 1 %; CPU БД стабильно &lt; 70 % (ориентир).

## DEGRADATION MODE (optional)

Только если согласовано с продуктом:

- не искажать **финансовые** данные без явного UX;  
- пример: `{ "status": "degraded", ... }` для безопасных GET.

---

## EXISTING SYSTEM — DO NOT REBUILD

Уже в репо (продолжать, не дублировать слепо):

- `shopBundleCache`, `taskCatalogCache`, `taskUserListCache`  
- `runRevocationChecksBatched` в `tasks.ts`  
- `Promise.all` в `buildMeEconomyResponse`  
- `slow_api_request`, `API_SLOW_REQUEST_MS`  
- BullMQ в `queue/bullmq.ts`

---

## DELIVERABLES

1. **Root Cause Report (обязательно):** топ-3 реальных bottleneck; **proof** (логи / trace / план запроса); объяснение, **почему** хвосты доходят до 60 s.  
2. **Fix Plan:** quick wins (pool, locks, лимиты) → medium (SWR, SQL) → long-term (workers, снапшоты).  
3. **Architecture Proposal:** целевая схема + шаги миграции без breaking changes.  
4. **Observability Plan:** метрики, дашборды, пороги алертов.

---

## CORE PRINCIPLE

> Нельзя ограничиться «оптимизацией кода» без данных. Нужно выявить **системные** bottleneck и подтвердить их **измерениями**.

## SHORT EXECUTION MODE

Если время ограничено: **доказать** причину 60 s через trace + метрики пула БД + поведение Redis; устранить **connection starvation**, **stampede**, блокирующие цепочки; вынести оставшееся тяжёлое в workers; закрепить **thin API + кэшированные чтения**.

---

*Документ — единое ТЗ для AI-агента; согласование degraded/economy — с владельцем продукта.*

---

## Реализовано в коде (итерация)

- **`lib/singleFlight.ts`** — дедупликация параллельных вычислений на один ключ (защита от cache stampede на одном процессе).
- **`getActiveTasksCached`** — single-flight загрузки каталога из Postgres при промахе Redis; повторная проверка Redis после ожидания.
- **`getShopClientBundle`** — single-flight на `shop:bundle:load:{platform}` + повторная проверка Redis.
- **`listTasksForUser`** — тяжёлое построение DTO вынесено в `computeUserTaskDtoList`, вызов через `singleFlight(tasks:userdto:{userId})`.
- **`db/index.ts`** — `pg.Pool` с `PG_POOL_MAX`, `PG_CONNECTION_TIMEOUT_MS`, `PG_IDLE_TIMEOUT_MS`; экспорт **`pool`** для метрик.
- **`lib/pgPoolMetrics.ts`** — при `PG_POOL_METRICS_MS≥5000` периодический `warn` при `waitingCount > 0` (если поддерживается версией `pg`).
- **`lib/redis.ts`** — **`warmupRedis()`** (ping до listen).
- **`index.ts`** — `warmupRedis()`, старт метрик пула, `onClose` снимает интервал.
- **`queue/bullmq.ts`** — `connectTimeout: 10000` для коннекта BullMQ.

Дальше по ТЗ: распределённый lock (Redis SET NX) при горизонтальном масштабировании, APM/p95, нагрузочные сценарии k6.

### Следующий шаг агента (trace-driven resolver)

Полное ТЗ без новых метрик: **[AI_AGENT_TRACE_DRIVEN_ROOT_CAUSE_RESOLVER_TZ.md](./AI_AGENT_TRACE_DRIVEN_ROOT_CAUSE_RESOLVER_TZ.md)** — диагноз по логам → proof → минимальный фикс.

### Post-optimization tracing (следующая итерация)

- **`lib/requestTrace.ts`**: `initRequestTrace` / `markRequestTrace`; в логах **`requestTraceMs`** (метки от старта запроса, мс) и **`handlerApproxMs`** (время после auth → ответ).
- **`plugins/auth.ts`**: метки `auth_skip_no_bearer`, `jwt_verified`, `db_user_lookup`, `auth_complete`.
- **`index.ts`**: `onRequest` инициализирует trace; `onResponse` объединяет **`slow_api_request`** (с трассой) и выборочный **`request_trace`** (`API_TRACE_SAMPLE_RATE`, `API_TRACE_MIN_MS`).
- **`lib/eventLoopMonitor.ts`**: `monitorEventLoopDelay`; при `EVENT_LOOP_MONITOR_MS` ≥ 1000 — периодический **`event_loop_lag`** при превышении `EVENT_LOOP_LAG_WARN_MS`.
