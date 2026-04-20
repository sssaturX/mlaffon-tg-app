# Final performance report — web app + API

**Версия документа:** 1.0 (шаблон для релиза)  
**Дата заполнения:** _указать при freeze_  
**Среда замеров:** _staging / production_

---

## Важно про данные в этом файле

| Тип утверждения | Источник |
|-----------------|----------|
| Реализовано в коде (архитектура, метрики, пороги) | Репозиторий: `apps/web`, `apps/api`, документы ниже |
| Численные **before/after** и **p50/p95** | **Не сгенерированы в CI** — их вносит команда по [`perf-baseline.md`](perf-baseline.md), DevTools, Prometheus |
| Сравнение с «до массовых оптимизаций» | Возможно **только частично** из старых заметок/скринов; иначе колонка *Previous* пустая |

Без заполненных таблиц из §2–§5 этот документ остаётся **контрактом измерений**, а не отчётом с подтверждёнными ms.

---

## 1. Executive summary

### Что по коду уже сделано (подтверждено реализацией)

- **Startup:** shell-first; bootstrap не блокируется вечным `!ready`; `prefetchOnBootstrap` только home (idle), без tasks/shop в первом кадре; **WebSocket** подключается после `requestIdleCallback` / короткой задержки при наличии `me` (`App.tsx`).
- **Route transitions:** `AnimatePresence` в режиме **`popLayout`**, exit ~**0.14 s**; intent prefetch (**chunk + data**): hover / pointerdown / touchstart / click; DEV User Timings `mlaffon: nav→mount` — см. [`route-transition-latency.md`](route-transition-latency.md).
- **API GET:** Redis-бандл shop per platform (v2, TTL 180s), tasks — кэш user DTO до revoke; метрики histogram/counter — см. [`dynamic-routes-performance.md`](dynamic-routes-performance.md).
- **Fortune config:** публичный путь, **без** DB в preHandler для `/api/v1/games/fortune/config`.
- **Render:** виртуализация Tasks при **≥12** плоских строк; `TaskCardPreview` / `ShopShowcaseItem` — `React.memo` + стабильные колбэки — см. [`react-render-performance.md`](react-render-performance.md).

### Что нужно измерить перед релизом

- Startup: DOMContentLoaded, Load, число запросов, transfer size — см. [`perf-baseline.md`](perf-baseline.md) §A.
- Route transitions: click→mount из User Timings — §B.
- API: cold/warm, TTFB, localhost vs origin — §C + таблица §4 ниже.
- Profiler: largest commit на Tasks/Shop — §E.

### Оставшиеся классы рисков (типовые, до замеров)

| Класс | Пример | Blocking? |
|-------|--------|-----------|
| Сеть / TLS / CDN | Высокий TTFB только через origin | Часто **blocking** для UX |
| Backend DB/Redis | Долгий `miss_compute` / rebuild | **Blocking** до ответа |
| Route transition | Lazy chunk без prefetch | **Non-blocking** если prefetch сработал; иначе **blocking** до mount |
| Render | Длинный commit при огромном списке без виртуализации | **Blocking** main thread |
| Восприятие | Скелетон + быстрый ответ, но тяжёлый paint | **Perception**, не всегда сеть |

---

## 2. Startup metrics

| Metric | Current | Previous | Notes |
|--------|---------|----------|-------|
| DOMContentLoaded | _TBD_ | _TBD_ | Performance / Lighthouse |
| Load | _TBD_ | _TBD_ | |
| First visible shell | _TBD_ | _TBD_ | Шапка + layout без данных |
| First meaningful UI | _TBD_ | _TBD_ | Например home content / баланс |
| Startup request count | _TBD_ | _TBD_ | Окно 0–3 s после navigation |
| Blocking requests (list) | _TBD_ | _TBD_ | Имена URL из Network |
| Total transferred (startup) | _TBD_ | _TBD_ | KB |

**Текущий startup flow (код):**

1. Shell / root mount.
2. TMA: `initData` → JWT; иначе существующий token / web login.
3. `useMergedMe` при `sessionBootstrapReady` → **`GET /api/v1/me`** (session).
4. После `me`: `prefetchOnBootstrap` (idle) → **home content + giveaways list** — не tasks/shop/games.
5. **WS:** `wsDeferred` = true после idle (до 2 s) или 400 ms fallback — только тогда `useRealtimeWebSocket` enabled.
6. Route-специфичные запросы — **по переходу** или **intent prefetch** на табах.

**Исключено из «жёсткого» старта (по дизайну):** глобальный prefetch tasks/shop; ранний WS; (по контексту продукта) VAPID/Web Push в первом кадре.

**Потенциальные idle gaps:** ожидание `me`; первый кадр после TMA auth — фиксировать в Performance trace.

---

## 3. Route transition metrics

| Route | click→mount (ms) | click→request start (ms) | Visible content (ms) | Prefetch chunk hit | Prefetch data hit | popLayout note |
|-------|------------------|----------------------------|----------------------|--------------------|-------------------|----------------|
| /tasks | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | vs legacy `wait`: см. [`route-transition-latency.md`](route-transition-latency.md) |
| /shop | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | |
| /games | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | config без JWT в prefetch |
| /giveaways | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | |
| /giveaway/:id | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | |

**Измерение:** DEV → User Timings `mlaffon: nav→mount …`; Network → время до первого байта нужного XHR/fetch. **Query start** ≈ момент появления запроса в Network после навигации (без hover prefetch — отдельный сценарий «cold click»).

---

## 4. Dynamic API metrics

Заполнить после [`perf-baseline.md`](perf-baseline.md) §C и Prometheus.

| Route | Platform | Cold total (s) | Warm total (s) | TTFB (s) | localhost (s) | origin (s) | Cache / notes |
|-------|----------|------------------|----------------|----------|---------------|------------|---------------|
| GET /api/v1/tasks | twitch | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | `tasks_list_*`, `tasks_http_seconds` |
| GET /api/v1/tasks | kick | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | |
| GET /api/v1/tasks | all | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | если используется в клиенте |
| GET /api/v1/shop/items | twitch | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | `shop_bundle_*`, v2 Redis |
| GET /api/v1/shop/items | kick | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | |
| GET /api/v1/games/fortune/config | — | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | без JWT; малый JSON |
| GET /api/v1/games/fortune/state | — | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | JWT; DB read |

**Интерпретация:**

- Если **localhost быстро**, **origin медленно** → смотреть TLS, CDN, очередь, не только handler.
- Если **TTFB ≈ total** и payload маленький → узкое место **не transfer size**, а сервер/очередь до ответа.
- **Hit/miss:** Prometheus `shop_bundle_cache_total`, `tasks_list_cache_total` + логи `[shop] slow …`, `[tasks] slow …`.

---

## 5. Render metrics

| Screen | Largest commit (ms) | Commit count (scenario) | Top heavy component | Virtualization | Notes |
|--------|----------------------|---------------------------|---------------------|----------------|-------|
| Tasks | _TBD_ | _TBD_ | _TBD_ | ON if ≥12 rows | Profiler |
| Shop | _TBD_ | _TBD_ | _TBD_ | N/A (grid) | memo cards |

---

## 6. Bottleneck classification

_Заполнить после замеров._

| Issue | Type (backend / trigger / render / network / perception) | Severity | User impact | Recommendation |
|-------|------------------------------------------------------------|----------|-------------|----------------|
| _example_ | _network_ | High | Slow TTFB via CDN | Проверить edge, keep-alive |
| | | | | |

**Известные нерешённые только кодом (требуют данных):**

- Точный **hit ratio** shop/tasks в проде по времени суток.
- Длинные хвосты **p99** на `revoke_external` для tasks при miss.

---

## 7. Final verdict

_Поставить только после заполнения §2–§5._

| Area | Status |
|------|--------|
| Startup | _good / acceptable / needs work_ |
| Tasks (API + UX) | _good / acceptable / needs work_ |
| Shop | _good / acceptable / needs work_ |
| Overall perceived speed | _good / acceptable / needs work_ |

---

## 8. Recommended next steps (по приоритету)

1. Заполнить [`perf-baseline.md`](perf-baseline.md) на staging одним «замороженным» билдом web + API.
2. Снять Prometheus за 24–48 ч: p50/p95 `shop_items_http_seconds`, `tasks_http_seconds`, hit ratios.
3. При расхождении localhost vs origin — приложить HAR + Timing скрин ([`browser-network-timing-capture.md`](browser-network-timing-capture.md)).
4. Если Tasks всё ещё «тяжело» при warm hit — разделить: **Profiler** (render) vs **Timing** (TTFB).

---

## 9. Startup flow analysis (деталь)

| Шаг | Что происходит | Сетевые запросы (типично) |
|-----|----------------|---------------------------|
| 1 | HTML + bundle JS/CSS | Статика с origin |
| 2 | TMA init / JWT в storage | При необходимости `POST /auth/telegram` и т.д. |
| 3 | Shell виден | — |
| 4 | `GET /me` при готовности сессии | `queryKeys.me.session` |
| 5 | Idle prefetch home | `home/content`, `home/giveaways` |
| 6 | WS отложен | Подключение wss после idle |
| 7 | Остальное | По навигации / prefetch табов |

**Убрано из критического пути (по контексту продукта):** VAPID в startup; немедленный WS; глобальный prefetch tasks/shop.

---

## 10. Route transition path (деталь)

Цепочка: **nav intent** → `prefetchRoutePageChunk` + `prefetchRouteData` → (React Router) → **popLayout** анимация → **lazy mount** → **useQuery** → fetch → render.

Измеримая задержка может быть в: **lazy chunk** (если не было intent), **очереди браузера**, **TTFB API**, **commit React**.

---

## 11. Focused: `/api/v1/tasks`

- **Платформы:** twitch / kick / all — разный filter на клиенте после одного списка; сервер — `listTasksForUser` + `filterTasksForPlatform`.
- **Кэш:** user DTO Redis до `runRevocationChecksBatched` на warm — см. [`dynamic-routes-performance.md`](dynamic-routes-performance.md).
- **Восприятие:** при смене платформы **нет** `keepPreviousData` для tasks (намеренно), возможен краткий loading — не путать с медленным API.

Разделение при жалобах «медленно»: (1) Network Timing TTFB, (2) User Timings click→request, (3) Profiler после получения данных.

---

## 12. Focused: `/api/v1/shop/items`

- Redis bundle **v2**, TTL **180s**, invalidation на покупку/админку.
- Малый JSON → узкое место редко в **размере**, чаще в **TTFB** или **позднем старте** fetch после mount.

---

## 13. Config / state (fortune)

| Endpoint | Auth | Типичная задержка (ожидание) |
|----------|------|------------------------------|
| `/games/fortune/config` | Нет | Низкая TTFB (in-memory), не блокируется DB preHandler |
| `/games/fortune/state` | JWT | DB read — смотреть отдельно |

---

## 14. Connection / network

_Заполнить по факту._

| Check | Result |
|-------|--------|
| HTTP/2 в браузере (Protocol h2) | _TBD_ |
| localhost vs origin delta | _TBD_ |
| DNS/TLS/Connect доли в Timing | _TBD_ |
| Stalled/Queueing значимы? | _TBD_ |

Same-origin SPA + `/api/*` — часто reuse одного соединения; см. [`last-mile-performance.md`](last-mile-performance.md), Caddy комментарий в `deploy/Caddyfile`.

---

## 15. Артефакты и ссылки на документы

| Документ | Назначение |
|----------|------------|
| [`perf-baseline.md`](perf-baseline.md) | Шаблон таблиц, curl, Profiler |
| [`dynamic-routes-performance.md`](dynamic-routes-performance.md) | Prometheus, кэши API |
| [`route-transition-latency.md`](route-transition-latency.md) | popLayout, prefetch, User Timings |
| [`react-render-performance.md`](react-render-performance.md) | Virtualization, memo |
| [`browser-network-timing-capture.md`](browser-network-timing-capture.md) | HAR, Timing breakdown |

**Вложения (вне git):** HAR, скриншоты Network/Profiler — ссылки в релизных заметках или тикете.

---

## Definition of done (для этого отчёта)

- [ ] Заполнены §2–§5 фактическими числами с staging/production  
- [ ] Указано, есть ли **previous** baseline или только **current**  
- [ ] §6–§8 обновлены выводами  
- [ ] Команде достаточно данных для приоритизации следующих шагов  
