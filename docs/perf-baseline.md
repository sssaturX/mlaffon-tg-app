# Performance baseline — шаблон для замеров (staging / production)

Этот файл предназначен для **заполнения командой** при приёмке. Цифры здесь не генерируются CI автоматически.

**Правило:** если нет сохранённого «до» оптимизаций — колонку *Previous* оставить пустой или указать «approx. from notes (YYYY-MM-DD)».

---

## A. Startup (браузер)

Инструмент: Chrome DevTools → **Performance** (record) или **Lighthouse** (navigation).

| Метрика | Как снять | Current | Previous | Notes |
|---------|-----------|---------|----------|-------|
| DOMContentLoaded | Performance → Timings | | | |
| Load | Performance → Timings | | | |
| First visible shell | Визуально + скрин кадра / `first-paint` если доступно | | | |
| First meaningful UI | Когда виден контент главной / шапка с балансом | | | |
| Request count (0–N s) | Network, отметить окно «startup» | | | |
| Blocking requests | Network → Priority / Timing Stalled | | | |
| Transferred size (HTML+JS+CSS) | Network → bottom summary | | | |

Рекомендуемое окно записи: **3–5 s** после hard reload с **Disable cache** (для cold); отдельно **warm** reload с кэшем.

---

## B. Route transitions (DEV User Timings)

Требуется `import.meta.env.DEV` и метки `mlaffon: nav→mount` из `apps/web/src/perf/routeTransitionPerf.ts`.

| Route | click→mount (ms) | chunk hit Y/N | prefetch data hit Y/N | Notes |
|-------|------------------|---------------|------------------------|-------|
| /tasks | | | | |
| /shop | | | | |
| /games | | | | |
| /giveaways | | | | |

Проверка prefetch: Network — дубликат запроса отсутствует при уже прогретом кэше TanStack Query.

---

## C. API — curl (localhost vs origin)

Подставить: `API=https://your-origin` или `http://127.0.0.1:3001`, `TOKEN=<JWT>`.

**TTFB-ориентир:** смотреть поле `time_starttransfer` (curl).

### Пример: tasks (warm ×2)

```bash
curl -sS -o /dev/null -w "total=%{time_total}s ttfb=%{time_starttransfer}s size=%{size_download}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$API/api/v1/tasks?platform=twitch"

curl -sS -o /dev/null -w "total=%{time_total}s ttfb=%{time_starttransfer}s\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$API/api/v1/tasks?platform=twitch"
```

### Shop items

```bash
curl -sS -o /dev/null -w "total=%{time_total}s ttfb=%{time_starttransfer}s\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$API/api/v1/shop/items?platform=twitch"
```

### Fortune config (без JWT)

```bash
curl -sS -o /dev/null -w "total=%{time_total}s ttfb=%{time_starttransfer}s\n" \
  "$API/api/v1/games/fortune/config"
```

### Fortune state (с JWT)

```bash
curl -sS -o /dev/null -w "total=%{time_total}s ttfb=%{time_starttransfer}s\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$API/api/v1/games/fortune/state"
```

Заполнить таблицу в `final-performance-report.md` §4.

---

## D. Prometheus (API)

Доступ: `GET /metrics` (если защищено — `?key=`).

Примеры (PromQL):

- Средняя длительность handler shop: `rate(shop_items_http_seconds_sum[5m]) / rate(shop_items_http_seconds_count[5m])`
- Hit ratio shop bundle: `sum(rate(shop_bundle_cache_total{result="hit"}[5m])) / sum(rate(shop_bundle_cache_total[5m]))`
- Tasks build по фазам: `tasks_list_phase_seconds`

---

## E. React Profiler

1. Production build: `npm run build && npm run preview` в `apps/web`.
2. React DevTools → **Profiler** → Record.
3. Сценарии: mount Tasks → данные пришли → смена платформы → открыть Shop → выбрать товар.

| Screen | Largest commit (ms) | # commits | Heaviest component | Virtualization ON |
|--------|----------------------|-----------|--------------------|-------------------|
| Tasks | | | | ≥12 rows → virtual |
| Shop | | | | memo cards |

---

## F. HAR / скриншоты

Прикладывать к релизу (вне git или в артефакты CI):

- `network-startup.har`
- `timing-tasks-warm.png` (вкладка Timing)
- опционально `profiler-tasks.json` export

Ссылки на файлы можно вставить в `final-performance-report.md` §13.
