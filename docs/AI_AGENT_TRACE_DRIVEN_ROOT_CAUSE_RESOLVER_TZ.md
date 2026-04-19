# AI AGENT TASK — TRACE‑DRIVEN ROOT CAUSE RESOLVER (без новых метрик)

Скопируйте этот документ целиком агенту. Он предполагает, что в проекте уже есть `request_trace` / `slow_api_request`, `event_loop_lag`, `pg_pool_waiting` (опционально) и включаемые env‑параметры.

---

## Контекст проекта

- **Репо:** `mlaffon-tg-app`
- **Backend:** `apps/api` (Fastify, Drizzle, PostgreSQL, Redis/ioredis, BullMQ)

### Уже внедрено

- `slow_api_request` (порог `API_SLOW_REQUEST_MS`)
- `request_trace` (метки `requestTraceMs`, `handlerApproxMs`)
- `event_loop_lag` (event loop monitor)
- Настроенный `pg.Pool` (env `PG_*`)
- Single-flight для hot путей (в рамках одного процесса Node)

### Цель

Устранить **редкие spikes 10–60s** с **доказательствами**, не расширяя наблюдаемость в коде.

---

## MISSION (строго)

Только одно: **диагноз → proof → минимальный фикс** для оставшихся latency spikes.

---

## HARD RULES

### Запрещено

- добавлять новые метрики / логирование / кэши / пулы
- «оптимизировать вообще» без доказательств
- менять архитектуру (только минимальный patch под **подтверждённую** причину)

### Разрешено

- анализировать логи `slow_api_request`, `request_trace`, `event_loop_lag`, `pg_pool_waiting`
- коррелировать их по времени
- делать точечные `EXPLAIN (ANALYZE, BUFFERS)` **только если** trace указывает на DB‑phase
- фиксить таймауты / ретраи **только если** есть характерные «silent gaps» / паттерны **~60s**

---

## INPUTS (что агент должен запросить / собрать)

1. **20–50 строк** логов `slow_api_request` + соответствующие `request_trace` за период, где были spikes (10–60s).
2. Логи `event_loop_lag` за тот же период.
3. (Если включено) логи `pg_pool_waiting` за тот же период.
4. Точное окружение: где API, где Postgres, где Redis (одна машина / разные регионы).

---

## PHASE 1 — TRACE CLASSIFICATION ENGINE (обязательное)

Для **каждого** slow request (≥2s или sampled) классифицировать по признакам.

### A) AUTH‑DELAY

**Признак:** `requestTraceMs.auth_complete` большой **или** метки `jwt_verified` / `db_user_lookup` приходят поздно.

**Вывод:** проблема в auth middleware / DB lookup / сеть к Postgres.

### B) HANDLER‑DELAY

**Признак:** `auth_complete` маленький, но `handlerApproxMs` большой.

**Вывод:** проблема в обработчике (tasks / shop / economy), сериализация, тяжёлые преобразования, внешние вызовы.

### C) EVENT‑LOOP‑CPU

**Признак:** корреляция slow запросов с `event_loop_lag` ≥ 100ms.

**Вывод:** CPU‑блокировка (sync код / JSON / массивы / crypto).

### D) INFRA / TIMEOUT GAP (критично для ~60s)

**Признак:** огромный «silent gap» (почти нет меток, а elapsed ≈ 60s / 30s / 10s) **или** скачок от ранней метки сразу к `response_sent`.

**Вывод:** таймаут / ретрай цепочка (proxy, TCP connect, DNS, Redis reconnect, pg connect).

### E) DB‑BOUND

**Признак:** `pg_pool_waiting` совпадает по времени **или** trace показывает, что после auth начинается долгий handler без event loop lag (подозрение на ожидание БД / Redis).

**Требование:** подтверждать DB‑bound только через **EXPLAIN** или пул / pg‑логи.

**Запрещено оставлять «unknown».** Если данных не хватает — агент формулирует, **каких именно** логов за период не хватает (**не** добавляя новые метрики в код).

---

## PHASE 2 — CORRELATION (обязательное)

Собрать «timeline»:

- `slow_api_request` (endpoint, ms, contentLength)
- `request_trace` (`requestTraceMs` + `handlerApproxMs`)
- `event_loop_lag` (mean / max)
- `pg_pool_waiting` (waiting / idle / total)

Вывести **причинно‑следственную цепочку**: что первично (CPU лаг → очередь запросов → таймауты) или (пул / сеть → ожидание → долгий handler без CPU лаг).

---

## PHASE 3 — 60s SPECIAL CASE (приоритет №1)

Если spikes близки к **~60s**:

1. Проверить таймауты прокси / LB (Caddy / systemd), TCP connect timeouts.
2. Проверить `pg` `connectionTimeoutMillis` vs фактические 60s (если mismatch — значит **не** pool timeout, а сеть / маршрутизация / драйвер / infra).
3. Проверить Redis reconnect stall / blocked DNS.
4. Проверить повторное исполнение (ретраи): одинаковые запросы с близкими timestamps.

**Результат:** конкретная цепочка (например: «DNS stall на Redis → WS‑ticket ждёт ioredis connect → 60s»).

---

## PHASE 4 — DB VALIDATION (только если trace указывает на DB)

- Найти SQL / участки кода на горячем пути.
- Снять `EXPLAIN (ANALYZE, BUFFERS)` на реальных таблицах.
- Проверить: индекс / seq scan, неожиданно большие result sets, N+1, lock waits.

Фикс допускается **только после** этого.

---

## PHASE 5 — EVENT LOOP ROOT CAUSE (только если есть корреляция)

Найти конкретный участок:

- тяжёлый `JSON.stringify` / большие DTO
- большие `map` / `sort` / `reduce`
- sync crypto
- (редко) sharp / другая CPU‑работа на request path

**Фикс:** минимальный (уменьшить payload, убрать лишние поля, прекратить сортировку на больших массивах, мемоизировать / кэшировать результат, перенести тяжёлое из request path — **если** это доказано как root cause).

---

## OUTPUT FORMAT (строго для каждого root cause)

Для **каждого** повторяющегося паттерна spikes:

1. **Root cause** (одно предложение, evidence-based)
2. **Evidence** (конкретные поля из `requestTraceMs`, `handlerApproxMs`, корреляция с `event_loop_lag` / `pg_pool_waiting`, таймштампы)
3. **Fix type** (ровно одно): `CPU fix` / `DB fix` / `Redis fix` / `Infra fix` / `Retry fix`
4. **Minimal patch plan** (1–5 шагов, без «переписать архитектуру»)
5. **Validation:** как доказать, что spike ушёл (какие логи / пороги / p95)

---

## SUCCESS CRITERIA

- Все spikes 10–60s имеют **детерминированную** классификацию (без «unknown»).
- Для каждого класса есть минимальный фикс + проверка.
- Под нагрузкой:
  - p95 &lt; 500ms (healthy)
  - нет «нормы» &gt; 2s
  - `event_loop_lag` стабильно &lt; 50ms
  - отсутствуют silent gaps ~60s

---

## CORE PRINCIPLE

> Observability уже есть. Задача агента — **только** diagnosis → proof → fix.

---

## SHORT MODE (если агент перегружен)

Использовать `request_trace` + `event_loop_lag` + DB timing correlation, чтобы найти **точный этап** spike. Классифицировать root cause (CPU, DB, network, retry, infra timeout). Дать **минимальный** проверенный фикс. Без спекулятивных оптимизаций.

---

## OPTIONAL META

Если несколько типов spikes — **приоритет повторяющемуся паттерну**, а не одиночным выбросам.

---

## Связанные документы

- [AI_AGENT_PERFORMANCE_ROOT_CAUSE_AND_ARCHITECTURE_TZ.md](./AI_AGENT_PERFORMANCE_ROOT_CAUSE_AND_ARCHITECTURE_TZ.md) — полный контекст оптимизаций и что уже внедрено в коде.
