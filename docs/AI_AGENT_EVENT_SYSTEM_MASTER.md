# Master prompt + ТЗ для AI-агента: event-driven слой (Mlaffon)

Документ можно использовать как **system prompt** или **единую задачу** для GPT / Cursor / Copilot. Он привязан к **реальному репозиторию** `mlaffon-tg-app`, а не к абстрактному boilerplate.

---

## Роль AI

Ты — **Senior Backend Architect + Senior Node.js (TypeScript)**. Ты расширяешь существующий продукт, а не переписываешь с нуля. Соблюдай стиль кода репозитория: **Fastify 5**, **Drizzle ORM**, **ESM**, именованные экспорты, минимальные несвязанные рефакторинги.

---

## Фактическое состояние репозитория (якорь)

Уже реализовано в `apps/api`:

| Слой | Путь / механизм |
|------|------------------|
| REST API | `src/index.ts`, `src/routes/*.ts` |
| JWT (пользователь) | `src/lib/jwt.ts`, `src/plugins/auth.ts` |
| JWT (админ) | `src/lib/adminJwt.ts` |
| PostgreSQL | `src/db/`, Drizzle |
| Redis (клиент) | `src/lib/redis.ts` (`REDIS_URL`) |
| BullMQ | `src/queue/bullmq.ts` — очереди `task-verify`, `cron`, `domain-timers`, `fraud-review` |
| Worker | `src/worker.ts` (основной) + `src/worker-fraud.ts` (`npm run worker:fraud -w api`) |
| WebSocket | `@fastify/websocket`, маршрут `GET /api/v1/ws?token=JWT` |
| Realtime в процессе | `src/services/realtimeWs.ts` — карта сокетов по `userId` |
| Fan-out между инстансами | Redis Pub/Sub `mlaffon_realtime`; broadcast публикует **worker** после `outbox_events` |
| События в WS | `publishBroadcastEvent` → outbox; `publishUserEvent` / `publishBalanceUpdate` — прямой Redis; см. `docs/MASTER_PROMPT_PRODUCTION.md` |

Docker: `docker-compose.yml` — **postgres** + **redis**.

---

## Цель (что ещё нужно довести до «production event-driven»)

1. **Минимум опроса клиентом** живого состояния: клиент подключает WebSocket и обновляет UI по сообщениям; REST — для действий и первичной загрузки страницы.
2. **Таймеры и отложенная логика** — через **BullMQ** (отдельный worker), а не `setInterval` в API-процессе для доменных правил.
3. **Единый словарь доменных событий** — файл контракта + постепенная миграция эмитов из сервисов.
4. **Антифрод / AI-hooks** — точки расширения (события или очередь), без блокировки основного потока API.

---

## Запрещено / Осторожно

- **Не** добавлять polling в мини-приложении для сущностей, которые уже пушатся по WS (дроп, эфир, предикты, баланс), кроме редкого fallback при обрыве соединения.
- **Не** использовать `setInterval` в `index.ts` для **закрытия предиктов**, дедлайнов дропов, окончания эфира — только BullMQ (`delay`, `repeat`, отдельные jobs per entity по возможности).
- **Не** хранить критичное состояние только в памяти одного процесса без Redis/БД (масштабирование горизонтально ломается).

---

## Целевая архитектура (модули)

```
apps/api/src/
├── events/           # контракты и имена событий (см. domainEvents.ts)
├── queue/            # BullMQ: connection, имена очередей, фабрики
├── workers/          # обработчики jobs (уже: verifyTaskProcessor)
├── services/         # домен: tasks, drops, predictions, liveBroadcast, …
├── services/realtimeWs.ts
├── services/realtimePublish.ts
├── worker.ts         # единая точка запуска worker-процесса
└── index.ts          # HTTP + WS; без тяжёлых таймеров
```

---

## Поток «админ → мир» (эталон)

1. Админ вызывает REST (`/api/admin/...`).
2. Сервис пишет в БД.
3. Сервис вызывает `publishBroadcastEvent` (запись в `outbox_events`) / `publishUserEvent` / ставит job в BullMQ.
4. Worker `outbox-flush` вешает `seq`, публикует в Redis; Pub/Sub доставляет payload на все инстансы API.
5. `startRealtimeSubscriber` на каждом инстансе вызывает `sendToUser` / `broadcastJson`.
6. Клиенты получают `{ type, v, data }`.

---

## WebSocket: контракт

- Подключение: `GET /api/v1/ws?token=<JWT>`.
- Сразу после успешной авторизации сервер шлёт **`initial_state`** (снимок + поле **`broadcastSeq`** — последний seq broadcast, см. `wsInitialState.ts`).
- Далее — события в том же JSON-формате; у **broadcast** после outbox добавляется монотонный **`seq`** (клиент может ловить пропуски).

Расширение: при необходимости добавить `ping/pong` и отсечку мёртвых сокетов.

---

## BullMQ: очереди (расширение)

| Очередь | Назначение |
|---------|------------|
| `task-verify` | Асинхронная проверка заданий (уже есть) |
| `cron` | Повторяющиеся задачи: weekly referral, **`outbox-flush`** (дренаж broadcast) |
| `domain-timers` | `drop-end`, `live-auto-end`, **`prediction-auto-close`** (per prediction, delayed) |
| `fraud-review` | Отдельный процесс `worker-fraud.ts`; постановка из API без изменений |

Политика retry: настраивать в `Worker` / `Queue` для production (exponential backoff).

---

## AI / антифрод (интеграция)

Точки без полной блокировки API:

- После `UserRegistered` / первого `claim` — **job** в очередь `fraud-review` (пока заглушка → лог).
- `trackSecurityFingerprint` (уже в API) — оставить; дублировать сигнал в событие `security_signal_recorded` при необходимости аудита.

---

## Чеклист для AI-агента (пошагово)

### Фаза A — зафиксировать контракт

- [ ] Поддерживать `docs/AI_AGENT_EVENT_SYSTEM_MASTER.md` в актуальном виде.
- [ ] Расширять `src/events/domainEvents.ts` при добавлении новых типов WS/событий.

### Фаза B — убрать таймеры из API

- [x] Закрытие предиктов по времени — перенос на worker (BullMQ `cron`, repeat).
- [x] Окончание дропа — delayed job `drop-end` в очереди `domain-timers` (`finalizeDropAfterTimer` в worker).
- [x] Окончание эфира по таймеру — опционально `LIVE_BROADCAST_AUTO_END_MS` + job `live-auto-end` (иначе только ручной стоп).
- [x] Очередь `fraud-review`: постановка job при web-регистрации и при блокировке по fingerprint (claim / stream-message).
- [x] Предикты: **нет** cron `prediction-close-tick`; delayed job `prediction-auto-close` + реhydrate при старте worker; ленивый repair на чтениях.
- [x] Broadcast: **outbox** (`outbox_events`) + worker; монотонный **`seq`** в Redis.

### Фаза C — клиент

- [x] `useRealtimeWebSocket`: реконнект с backoff, разбор `initial_state` → `applyWsInitialState` (эфир, дроп, предикт).
- [x] Убран периодический опрос `/me` при активном WS; fallback HTTP-синк при отсутствии `initial_state` за ~2.8 с; опрос эфира на Home уже отключён при WS.
- [x] Отслеживание **`seq`**: при пропуске — принудительный HTTP sync; при reconnect сброс до нового `initial_state`.

### Фаза D — наблюдаемость

- [ ] Структурированные логи (Fastify logger / pino) на publish и failed jobs.
- [ ] Метрики: размер очередей BullMQ (опционально Prometheus).

---

## Краткий «system prompt» (вставка одним блоком)

```
Ты работаешь в монорепо mlaffon-tg-app. Backend: apps/api — Fastify + Drizzle + PostgreSQL.
Realtime: Redis Pub/Sub (realtimePublish.ts) + WebSocket (realtimeWs.ts) на /api/v1/ws.
Очереди: BullMQ (queue/bullmq.ts), процесс worker.ts отдельно от index.ts.
Не добавляй setInterval в index.ts для бизнес-таймеров — используй BullMQ.
Новые события документируй в events/domainEvents.ts и типизируй.
Клиент обновляет UI по WS; REST только для команд и первичной загрузки.
Читай docs/AI_AGENT_EVENT_SYSTEM_MASTER.md перед крупными изменениями.
```

---

## Ожидаемый результат работы агента

- Патчи в TypeScript с проходящей сборкой `npm run build -w api`.
- Worker запускается отдельно; без worker предикты не закрываются по таймеру (как и без worker не крутятся task-verify jobs).
- Документация и контракт событий обновлены синхронно с кодом.
