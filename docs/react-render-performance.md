# React render performance (Tasks, Shop, heavy lists)

## 1. Где был render cost

| Зона | Проблема |
|------|----------|
| **Tasks** | Все карточки в DOM сразу; `renderTaskCard` создавал новое дерево на каждый parent render; нет `React.memo` |
| **Shop** | Inline `map` с тяжёлыми кнопками-карточками без мемоизации |
| **Evidence thumbnails** | `loading="lazy"` уже был; добавлен `decoding="async"` |

Точные **ms** нужно снять локально: React DevTools → **Profiler** → record → открыть Tasks / дождаться данных / сменить платформу. Сравнить commit duration до/после ветки.

## 2. Виртуализация (Tasks)

- Зависимость: `@tanstack/react-virtual` (`useWindowVirtualizer`).
- Порог: **`TASK_FEED_VIRTUAL_THRESHOLD` = 12** плоских строк (заголовки секций + карточки). Ниже — обычный `map` без виртуализации.
- Скролл: **window** (как у основного layout), `scrollMargin` от якоря списка, строки с **`measureElement`** для переменной высоты.
- Файлы: `components/tasks/TaskVirtualFeed.tsx`, `components/tasks/TaskCardPreview.tsx`.

## 3. Мемоизация

| Компонент | Мера |
|-----------|------|
| `TaskCardPreview` | `React.memo` + стабильные `onOpenDetail` / `onOpenHelp` из `useCallback` в `Tasks.tsx` |
| `ShopShowcaseItem` | `React.memo` + `onSelect` через `useCallback` в `Shop.tsx` |
| Группировка заданий | Уже в `useMemo` (`grouped`, `sectionKeys`) |

## 4. Platform switch / state

- **Tasks:** `keepPreviousData` для списка заданий **не** включали — при смене Twitch/Kick нельзя показывать чужой список во время загрузки.
- Shop по-прежнему использует `keepPreviousData` для витрины (уже было).

## 5. Список оптимизаций

1. Виртуальный список для длинной ленты заданий.
2. Вынесенные мемо-карточки Tasks и Shop.
3. Объединены два `useEffect` синхронизации модалок с `tasks` в один проход.
4. `decoding="async"` на превью примеров evidence.

## 6. Как измерить before/after

1. Production build: `npm run build` в `apps/web`, открыть `preview`.
2. Profiler: зафиксировать **Committed** время для interactions «mount Tasks», «data loaded», «switch platform».
3. Performance monitor: при длинном списке проверить отсутствие длинных задач **Scripting** > 50 ms подряд при скролле.

## 7. Rollout

- Новая зависимость уже в `package.json`; после pull — `npm install` в корне монорепо / `apps/web`.
- Визуально проверить длинный список заданий (много секций) и скролл на мобильной ширине.

## 8. Definition of done

- Длинные списки Tasks не держат все карточки в DOM одновременно (при ≥12 строках).
- Карточки мемоизированы; родитель не перерисовывает всё дерево без нужды.
- Документированы измерения и порог виртуализации.
