# GET `/api/v1/tasks` — performance hardening

## 1. Bottleneck analysis (before)

### Root cause: synchronous external APIs on every GET (including warm cache)

`listTasksForUser` вызывал **`runRevocationChecksBatched` до проверки Redis-кэша пользователя**.  
Для заданий с `meta.revokeOnUnsubscribe` цепочка `enforceTaskRevocationIfNeeded` → **`verifyPlatformTask`** дергала **Helix / Kick HTTP** (follow/subscription и т.д.).

Почему **twitch** мог быть заметно тяжелее **kick**:

- больше заданий с подпиской/follow на Twitch в каталоге;
- больше `revokeOnUnsubscribe` с проверками через **Helix** (`helixCheckFollow`, `helixCheckSubscription`);
- Kick-путь в том же `verifyPlatformTask` короче для `kind === "connected"`.

**Warm path** тоже страдал: даже при попадании в Redis (`getCachedUserTaskDtoList`) сначала выполнялись revoke-проверки → сеть → сотни мс–секунды.

### Другие факторы (остаются на cold path)

- `computeUserTaskDtoList`: параллельные запросы к БД (`buildProgressSnapshot`, `userTasks`, evidence) — без N+1 по задачам в основном цикле; тяжесть в основном на **первом промахе кэша**.
- Кэш пользователя: один ключ на полный список DTO (`userId`), фильтр `platform` в handler — **корректно**, смешения twitch/kick/all нет (фильтр после загрузки полного списка).

## 2. Выбранная стратегия (B7)

**A + инвариант чтения:** полный snapshot пользователя в Redis, дешёвая фильтрация по платформе в HTTP-handler (как было).

Дополнительно: **перенос `runRevocationChecksBatched` только на cold path** (после промаха Redis), а на **hit** — сразу возврат без сетевых проверок.

Компромисс: отзыв по отписке для редких кейсов может отставать до **TTL кэша пользователя** (30s). Инвалидация по claim / disconnect по-прежнему сбрасывает кэш.

## 3. Изменения backend

| Файл | Изменение |
|------|-----------|
| `apps/api/src/services/tasks.ts` | Порядок: Redis hit → return; иначе revoke → compute; метрики и slow-log |
| `apps/api/src/services/taskUserListCache.ts` | Префикс ключа **`v2`** (сброс старых записей при деплое) |
| `apps/api/src/lib/metrics.ts` | `tasks_list_build_seconds`, `tasks_list_cache_total`, `tasks_http_seconds` |
| `apps/api/src/index.ts` | Обёртка `tasksHttpSeconds` для GET `/api/v1/tasks` |

## 4. Метрики (Prometheus)

- `tasks_list_build_seconds{cache="hit\|miss_revoke_warmed\|miss_compute"}` — фазы внутри `listTasksForUser`.
- `tasks_list_cache_total{result="hit\|miss"}` — hit/miss Redis user list.
- `tasks_http_seconds{platform="twitch\|kick\|all"}` — полное время handler после auth.

Cold/warm цифры **не зашиты в репозиторий** — снимать на стенде через `/metrics` и нагрузочный профиль (см. B3).

## 5. Frontend

| Файл | Изменение |
|------|-----------|
| `apps/web/src/hooks/queries/useTasks.ts` | `enabled: !!getToken()`, `refetchOnMount/WindowFocus: false` |

Запросы tasks по-прежнему только с экрана Tasks (lazy route) и при hover-prefetch с токеном.

## 6. Rollout

- Деплой API + web вместе.
- После выката проверить p95 `tasks_http_seconds` по `platform` и долю `tasks_list_cache_total{result="hit"}`.

## 7. Definition of done (B)

- [x] Read path GET `/tasks` не вызывает внешние Twitch/Kick API на **warm** Redis hit.
- [x] Наблюдаемость по handler и фазам сборки.
- [x] Кэш платформ не смешивается (прежняя модель сохранена).
- [x] Frontend: нет лишнего refetch на фокус для tasks.
