# Last-mile latency (web + API)

Документ фиксирует **цепочку задержек**, внедрённые **точечные** оптимизации и то, что нужно **измерять** в production. Цель — не «магический prefetch всего», а предсказуемый UX при сохранении корректности.

## 1. Latency chain (где теряется время)

Типичный порядок для dynamic GET после клика по табу:

1. **User action** — клик / tap по `NavLink`.
2. **Router** — смена `location`.
3. **`RouteTransition` + `AnimatePresence`** — раньше `mode="wait"` откладывал mount до конца exit; сейчас **`popLayout`** и короче exit — подробнее [`route-transition-latency.md`](route-transition-latency.md).
4. **Lazy chunk** — если chunk не в кэше: загрузка + parse `Tasks` / `Shop` / `Games` (сотни ms+).
5. **React mount** — `useQuery` становится активным.
6. **HTTP** — Queueing / Stalled / DNS / TCP / TLS (часто мало при same-origin reuse) / **TTFB** / download.
7. **JSON parse + render** — список заданий / витрина.

Итог: даже при быстром API запрос может **стартовать поздно** из-за шагов 3–4. Поэтому важны **intent prefetch** (hover / pointerdown / touchstart / click) и отсутствие лишних `enabled: wait(me)`.

## 2. Idle gaps — что проверено в коде

| Область | Наблюдение |
|---------|------------|
| **Tasks / Shop queries** | `enabled: Boolean(getToken())` — JWT нужен API; `getToken()` синхронный, не ждёт React `me`. |
| **Fortune config** | Публичный endpoint; `useFortuneConfig` без привязки к токену. |
| **Fortune state** | Требует авторизации — корректно `enabled: getToken()`. |
| **Bootstrap** | `prefetchOnBootstrap` — только home (idle), без tasks/shop/games по дизайну (не конкурировать с первым `/me`). |
| **Каскад platform** | Отдельные query keys на platform; `refetchOnMount: false` для tasks — нет лишнего twitch→all→kick. |

## 3. Внедрённые оптимизации (frontend)

**Файл:** `apps/web/src/query/prefetch.ts`

- **`prefetchRoutePageChunk(pathname)`** — динамический `import()` страниц, совпадающих с `lazy()` в `App.tsx`. Вызывается из **`navPrefetchHandlers`** вместе с data prefetch: при наведении/касании таба chunk начинает грузиться **до** клика.
- **`prefetchRouteData` для `/games`** вынесен **до** `if (!getToken())`: префетчится **только** публичный `fortune/config`; `fortune/state` — при наличии токена.

Это **targeted early fetch** (сигнал навигации), не global bootstrap.

## 4. Preconnect / prewarm — решение

- **Same-origin** (`/api/v1/...` с того же host, что и SPA): отдельный `<link rel="preconnect">` на API **не даёт выигрыша** — соединение с origin уже установлено загрузкой HTML/ассетов.
- **Шрифты Google** — уже есть `preconnect` в `index.html`.
- **Разогрев соединения отдельным GET** — не добавлялся без измерений; риск лишней нагрузки.

## 5. HTTP/2, reuse, Caddy

- Браузер ↔ edge: **HTTP/2** и мультиплексирование — проверка в DevTools → колонка **Protocol** (`h2`).
- **Caddy** `reverse_proxy 127.0.0.1:3001`: к upstream по умолчанию используется пул соединений с keep-alive. Тонкая настройка `transport http { ... }` — только после профилирования.
- См. также `docs/cdn-edge.md` при CDN перед origin.

## 6. Backend TTFB

Метрики и кэши: `docs/dynamic-routes-performance.md`. Сравнение **localhost** vs **публичный origin** — в том же документе; расхождение указывает на сеть/прокси, а не на handler.

## 7. Route-specific

| Route | Клиент | Сервер |
|-------|--------|--------|
| **tasks** | Intent: chunk + `fetchTasks` при hover таба | Redis user list + catalog cache; см. метрики |
| **shop/items** | Intent: chunk + `prefetchShopCatalog` | Per-platform Redis bundle v2 |
| **fortune/config** | Публичный prefetch на `/games` без JWT | Статический ответ из config |
| **fortune/state** | Prefetch при hover только с токеном | Один DB read |

## 8. Наблюдаемость и before/after

- **Браузер:** `docs/browser-network-timing-capture.md` (Timing, waterfall, HAR).
- **Сервер:** Prometheus метрики из `docs/dynamic-routes-performance.md`.
- **Before/after:** фиксировать для одного и того же сценария (cold/warm, TMA vs web).

## 9. Rollout

- Деплой web: новые dynamic imports в prefetch **идемпотентны** (повторный `import()` — из кэша модулей).
- Нет изменений контрактов API.

## 10. Definition of done (продуктово)

- Нет искусственного ожидания `me` там, где endpoint не требует данных профиля для запроса.
- Intent prefetch покрывает основные табы без глобального «prefetch всего».
- Документирована цепочка задержек и способ измерения.
- Медленные пути сопровождаются HAR + Prometheus, а не только «ощущением».

## Изменённые / релевантные файлы

- `apps/web/src/query/prefetch.ts` — chunk prefetch, порядок games/config.
- `apps/web/src/pages/Home.tsx` — intent: chunk + data для ссылок на розыгрыши.
- `apps/web/src/components/RouteTransition.tsx` — `mode="popLayout"`, DEV measure.
- [`docs/route-transition-latency.md`](route-transition-latency.md) — сравнение режимов и измерения.
- `apps/web/src/App.tsx` — lazy-импорты должны совпадать с путями в `prefetchRoutePageChunk`.
- `deploy/Caddyfile` — reverse proxy к API (операционная проверка h2/reuse).
- `docs/dynamic-routes-performance.md`, `docs/browser-network-timing-capture.md` — метрики и съёмка в DevTools.
