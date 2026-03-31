# Целевая архитектура: event-driven клиент (realtime)

Документ фиксирует **направление развития** после аудита `API_WEB_CLIENT_AUDIT.md`: уйти от polling-heavy SPA к реактивной модели без потери актуальности данных.

---

## 1. Диагноз (текущее состояние)

| Симптом | Риск |
|--------|------|
| Интервалы `/me`, `/live-broadcast`; `/drops/active` только без WS | Нагрузка снижена vs ранний аудит, но эфир на главной всё ещё часто опрашивается |
| `refreshMe()` после части действий + `me_update` + таймер | Возможные дубли `GET /me` |
| WS: `me_update`, `drop_*`, `live_*`, legacy `balance_updated` | Основной realtime задействован; осталось убрать лишний полный `/me` по legacy |
| Ранг в `/me` (`leaderboardRankCoins`) | Отдельный `GET /leaderboard` на профиле не нужен |

Цель: **сервер пушит смысловые события → клиент обновляет store/UI**, polling только как **fallback** при обрыве WS или фоновой вкладке.

---

## 2. Целевая схема

```
[API / Worker] ──Redis pub/sub или in-process──► [WS connection] ──► [Client store]
                                                                      │
                                                                      ▼
                                                                    [UI]
```

Правило: **один источник правды для «живых» данных** — подписка на события; HTTP — стартовая гидратация, мутации, восстановление после ошибки.

---

## 3. Контракт WebSocket (расширение)

Сейчас: `{ "type": "balance_updated" }`.

Целевой минимальный набор (версионировать полем `v: 1` при смене контракта):

### 3.1 Пользователь / экономика

```json
{
  "type": "me_update",
  "v": 1,
  "data": {
    "coins": 1200,
    "coinsTwitch": 600,
    "coinsKick": 600,
    "level": 5,
    "rewardMultiplier": 1.25,
    "lifetimeEarned": 10000,
    "rankCoins": 123
  }
}
```

- Полный `MeResponse` пушить не обязательно — достаточно **диффа** или подмножества; клиент мержит в store.
- **`rankCoins`** убирает отдельный `GET /leaderboard` на профиле (см. §6).

### 3.2 Дропы

```json
{ "type": "drop_started", "v": 1, "data": { /* DropSnapshot или subset */ } }
```

```json
{ "type": "drop_updated", "v": 1, "data": { "endsAt": "...", "serverNow": "..." } }
```

```json
{ "type": "drop_finished", "v": 1, "data": { "dropId": "..." } }
```

После этого **интервал `GET /drops/active` не нужен**, если админка/воркер публикует события в тот же Redis-канал, что слушает API-процесс с WS.

### 3.3 Эфир

```json
{ "type": "live_started", "v": 1, "data": { "platform": "twitch", "streamUrl": "...", "id": "..." } }
```

```json
{ "type": "live_ended", "v": 1 }
```

Клиент переключает платформу в шапке и показывает карточку без 5-секундного опроса.

---

## 4. Стратегия мутаций (убрать лишние `refreshMe`)

| Ситуация | Действие |
|----------|----------|
| Мутация меняет баланс на сервере | Ждать `me_update` / `balance_updated` или optimistic update + reconcile по событию |
| Мутация меняет только локальный UI (закрыть модалку) | Без `/me` |
| Ошибка сети / подозрение на рассинхрон | Ручной `refreshMe()` |
| Старт приложения / восстановление сессии | `GET /me` |
| Reconnect WS | Один `GET /me` + при необходимости `GET /drops/active` |

**Optimistic updates** (опционально): магазин/промо — временно вычесть монеты в state до прихода WS.

**Debounce** для `refreshMe` (300–500 мс) — если решите оставлять часть ручных refresh, чтобы не было пачки при WS + клик.

---

## 5. Smart polling (fallback)

Когда WS недоступен:

- `/me`: не чаще **30 с** (вместо 5 с).
- `/drops/active`: реже, если **нет активного дропа** (например 30 с), чаще при активном (8 с) — только при **видимой вкладке**.
- `/live-broadcast`: при **нет эфира** — 20–30 с; при **эфир активен** — 5 с.

Когда вкладка **скрыта** (`document.hidden`):

- Таймеры **пауза** или множитель ×4–6.
- При возврате во вкладку — **один** синхронизирующий запрос (`/me`, дроп, live).

*Часть этого уже можно внедрять до полного WS-контракта.*

---

## 6. Объединение данных (HTTP)

Расширить **`GET /api/v1/me`**:

- `leaderboardRankCoins` (или `rank` в контексте `sort=coins&platform=all`) — убрать дублирующий запрос из `Profile.tsx`.

`GET /home/public` оставить для публичной статистики/FAQ; при желании — `Cache-Control` / CDN для статики.

---

## 7. Один клиентский store (рекомендация)

Ввести лёгкий **глобальный store** (Zustand / Jotai / Redux Toolkit):

- `me`, `dropSnapshot`, `liveBroadcast` — сущности, которые обновляются и из HTTP при старте, и из WS.
- Компоненты подписываются на срезы; уходит дублирование `refreshMe` в 10 страницах.

Минимальный переход: сначала **контекст** `MeContext` + редьюсер только для `me`, затем миграция дропа/эфира.

---

## 8. План внедрения по фазам

### Фаза A — быстрые победы (без новых WS-событий)

1. **Visibility control** — не крутить таймеры в фоне; при `visibilitychange` → visible — догрузка.
2. **Интервалы**: при отсутствии WS — реже опрос `/me`; дроп — реже без активного дропа; эфир — реже без активного эфира.
3. **Debounce** `refreshMe` (опционально).

*Соответствует шагам «fallback» и «visibility» из обсуждения.*

**Статус (внедрено):**

- **Фаза A:** `useDocumentVisible`; пауза таймеров в фоне; синк при возврате; fallback-интервалы снижены при подключённом realtime.
- **Фаза B (сервер):** канал Redis `mlaffon_realtime`; `publishBalanceUpdate` шлёт **`me_update`** с `buildMeEconomyPatch`; **`drop_started`** из `startDrop`; **`live_started` / `live_ended`** из `liveBroadcast`; подписчик доставляет в WS (`sendToUser` / `broadcastJson`).
- **Фаза C (клиент):** `useRealtimeWebSocket` — обработка `me_update` (merge в `me`), `drop_started`, `live_*`, legacy `balance_updated`; событие `window` `mlaffon-live` для `loadLive` на главной; убран лишний `GET /leaderboard` на профиле — **`leaderboardRankCoins` в `/me`**; убраны лишние `onRefresh` после промо/магазина/игр/розыгрыша/дропа где покрывает WS.

### Фаза B — сервер

1. Redis pub/sub (или существующий канал) для событий дропа из админки/сервиса дропов.
2. Публикация `live_*` при старте/стопе эфира в `liveBroadcast` сервисе.
3. Расширение `publishBalanceUpdate` → `publishUserEvent(userId, payload)` с типами `me_update`, …

### Фаза C — клиент

1. Один обработчик WS: роутинг по `type`, обновление store.
2. Удаление интервалов `loadDrop` / сокращение `loadLive` до fallback.
3. Убрать лишние `onRefresh` после мутаций, где пришёл WS.
4. Ранг в `/me`, удалить leaderboard из профиля.

### Фаза D — полировка

- Optimistic UI для покупок/промо.
- Метрики: счётчик запросов/мин в dev.

---

## 9. Файлы: куда смотреть при рефакторинге

| Область | Файлы |
|---------|--------|
| Таймеры, `me`, дроп | `apps/web/src/App.tsx` |
| Эфир | `apps/web/src/pages/Home.tsx` |
| WS клиент | `apps/web/src/hooks/useBalanceWebSocket.ts` → переименовать/расширить в `useRealtimeConnection.ts` |
| Realtime WS + Redis | `apps/api/src/services/realtimeWs.ts`, `realtimePublish.ts` |
| Экономика / пуш | `apps/api/src/services/economy.ts`, воркеры наград |
| Дропы (сервер) | `apps/api/src/services/drops.ts`, админ-роуты старта дропа |
| Эфир | `apps/api/src/services/liveBroadcast.ts` |
| Ранг в `/me` | `apps/api/src/services/me.ts`, `packages/shared` |

---

## 10. Целевые метрики

| Метрика | Было (оценка) | Цель |
|---------|----------------|------|
| Авто GET/мин на активного пользователя | ~20–30 | ~2–5 + редкий fallback |
| `GET /me` из таймера | часто | редко или только при offline WS |
| Дубли после POST | да | нет (WS/store) |

---

## 11. Связанные документы

- [API_WEB_CLIENT_AUDIT.md](./API_WEB_CLIENT_AUDIT.md) — текущая карта запросов и файлов.

---

*Документ — живой: при внедрении фаз обновлять §3 и §8.*
