# Route transition latency (web)

## 1. Где терялось время (цепочка)

| Шаг | Описание |
|-----|----------|
| 1–2 | Клик / tap по `NavLink` → смена `location` |
| 3–4 | **Раньше:** `AnimatePresence mode="wait"` — exit предыдущей страницы **полностью** (~200 ms), затем mount следующей |
| 5–6 | Lazy `import()` страницы (если chunk не прогрет) |
| 7 | Mount страницы → `useQuery` |
| 8–9 | HTTP до API |

Основной искусственный зазор давал **wait**: следующий route **не монтировался**, пока не закончится exit-анимация. Intent prefetch (chunk + data) частично компенсировал, но не убирал блокировку mount.

## 2. Сравнение режимов AnimatePresence

| Режим | Поведение | Риск UX |
|-------|-----------|---------|
| **wait** (было) | Вход после полного выхода | Максимальная задержка до mount / fetch |
| **sync** | Вход и выход одновременно | Возможное визуальное наложение без pop |
| **popLayout** (выбрано) | Выходящий элемент выводится из layout — входящий **может занять место сразу** | Нужен `position: relative` у контейнера (`.app-main`) |

**Production-решение:** `mode="popLayout"`, длительность **0.14 s** (было 0.2 s), при `prefers-reduced-motion` — по-прежнему почти мгновенно.

Как самостоятельно сравнить с `wait`: временно вернуть `mode="wait"` в `RouteTransition.tsx`, снять [DevTools Timing](browser-network-timing-capture.md) и User Timing (ниже).

## 3. Intent prefetch (desktop + mobile)

**Файл:** `apps/web/src/query/prefetch.ts`

- **pointerenter** — только `prefetchRoutePageChunk` + `prefetchRouteData` (hover, без perf-mark).
- **pointerdown**, **touchstart**, **click** — то же + **`markUserNavActivation`** (тап, мышь, активация с клавиатуры).

Так prefetch на **mobile** не зависит от hover; **touchstart** даёт ранний сигнал до `click`.

Экспорт **`linkPrefetchHandlers`** = те же хендлеры для `<Link>` на главной (розыгрыши).

## 4. Задержка mount → query

Логика **Tasks / Shop / Games** не зависит от roundtrip `me` для `enabled` (используется синхронный `getToken()`). Платформа для tasks берётся из `getStoredActivePlatform()` при создании query — без лишнего effect-cascade.

## 5. Дубликаты работы

- Повторные вызовы prefetch при pointerdown + click **сводятся** дедупликацией TanStack Query и **90 ms** дедупом perf-mark.
- Hover + последующий click — отдельные prefetch; второй обычно no-op по кэшу.

## 6. Маршруты

| Путь | Заметки |
|------|---------|
| `/tasks` | prefetch tasks list для текущей платформы из localStorage |
| `/shop` | prefetch витрины по активной платформе + вторая в idle |
| `/games` | config без JWT; state при наличии токена |
| `/giveaways`, `/giveaway/:id` | list prefetch по префиксу `/giveaway` (совпадает и с `/giveaways`) |

## 7. Измерения (before / after)

### DEV: User Timing

1. Открыть Chrome DevTools → **Performance** (или вкладка **Performance** → record).
2. Перейти между табами Tasks / Shop / Games.
3. В **User timings** искать измерения **`mlaffon: nav→mount /path`**.

Скрипт меток: `apps/web/src/perf/routeTransitionPerf.ts` (только `import.meta.env.DEV`).

### Ожидаемый эффект after

- Меньше **nav→mount** за счёт `popLayout` + короче exit.
- Ранний chunk/data при **touchstart/pointerdown** до полного click.

Точные ms зависят от устройства и сети — фиксировать вручную при приёмке.

## 8. Rollout

- Изменения только во фронте (`RouteTransition`, prefetch, стили).
- При регрессии визуала: откатить на `mode="sync"` или вернуть `wait` + оставить prefetch-хендлеры.

## 9. Definition of done

- Навигация по основным табам не блокируется полным exit, как при `wait`.
- Intent prefetch покрывает hover + touch + keyboard activation.
- Документирован режим и способ измерения.

## Файлы

- `apps/web/src/components/RouteTransition.tsx` — `popLayout`, длительность, `markRouteContentMounted`
- `apps/web/src/perf/routeTransitionPerf.ts` — DEV marks/measures
- `apps/web/src/query/prefetch.ts` — разделение hover / activation, `linkPrefetchHandlers`
- `apps/web/src/pages/Home.tsx` — ссылки на розыгрыши
- `apps/web/src/styles.css` — `.app-main { position: relative }`
