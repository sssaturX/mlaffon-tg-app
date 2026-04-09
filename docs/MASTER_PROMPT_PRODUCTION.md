# Master PROMPT + ТЗ: Event-Driven слой (Production Ready)

Документ для AI-агента и людей: **доделать систему до production**, опираясь на уже существующий код в `mlaffon-tg-app`, а не переписывать с нуля.

---

## Роль AI

Ты — **Senior Backend / Distributed Systems Engineer**. Задача: **не ломать** текущую архитектуру, а **усиливать** её (идемпотентность, очереди, доставка событий, наблюдаемость).

---

## Что уже сделано в репозитории (якорь)

| Область | Реализация |
|--------|------------|
| Realtime | Redis Pub/Sub + WS `/api/v1/ws`, `realtimePublish.ts`, `realtimeWs.ts` |
| `initial_state` | `wsInitialState.ts` + `broadcastSeq` (последний seq broadcast) |
| Broadcast seq | Redis `INCR mlaffon:realtime:broadcast_seq`, вешается в `outboxFlush.ts` |
| Outbox | Таблица `outbox_events`; `publishBroadcastEvent` **только** пишет в outbox; worker гонит `outbox-flush` (~500 ms) |
| Таймеры | `domain-timers`: `drop-end`, `live-auto-end`, `prediction-auto-close` |
| Предикты | Cron **2 s** для закрытия **снят**; delayed job per prediction + реhydrate при старте worker; ленивый `closeExpiredPredictionsNow` на чтениях (admin/list) |
| Идемпотентность | `finalizeDropAfterTimer`, `finalizePredictionAutoClose`, `endLiveBroadcast` проверяют актуальное состояние в БД |
| BullMQ | `defaultJobOptions`: 4 попытки, exponential backoff, `removeOnFail: false` (failed = аналог DLQ) |
| Воркеры | `worker.ts` — task-verify, cron, domain-timers, **без** fraud; `worker-fraud.ts` — отдельный процесс (`npm run worker:fraud`) |
| Клиент | WS: новый `initial_state` при каждом connect/reconnect; отслеживание `seq`; при пропуске seq → HTTP sync |

---

## Цели production-уровня (чеклист)

- [x] Нет «голого» `setInterval` в API для бизнес-таймеров.
- [x] Таймеры дропа / эфира / предикта — BullMQ delayed jobs с проверкой БД в worker.
- [x] Идемпотентные обработчики (повтор job не ломает состояние).
- [x] Монотонный `seq` на broadcast + `broadcastSeq` в `initial_state`.
- [x] Минимальный transactional outbox для broadcast.
- [x] Разделение fraud-worker.
- [ ] Расширенные метрики (Prometheus), pino-структура на каждый publish — по желанию.
- [ ] Outbox + доменные изменения в **одной** SQL-транзакции там, где критично (сейчас insert outbox после commit транзакции домена).

---

## Запрещено

- `setInterval` в `index.ts` для доменной логики.
- Публикация broadcast мимо outbox (иначе теряется единый `seq` и гарантии).
- Доверять `delay` BullMQ без проверки `endsAt` / `status` в БД.

---

## Операции

1. **Миграция БД**: применить `apps/api/drizzle/0001_outbox_events.sql` или `npm run db:push -w api`.
2. **Процессы**: API + **`npm run worker -w api`** обязательны для broadcast; опционально **`npm run worker:fraud -w api`**.
3. **Удалить старый repeatable job** `prediction-close-tick-repeat` в BullMQ (если остался от предыдущей версии), иначе лишние тики.

---

## Короткий system prompt (вставка)

```
Монорепо mlaffon-tg-app. Backend: Fastify + Drizzle + Postgres + Redis.
Broadcast realtime: только через outbox_events → worker outbox-flush → Redis Pub/Sub → WS.
Каждое broadcast-сообщение на wire имеет монотонный seq (Redis INCR).
Таймеры: BullMQ domain-timers (drop-end, live-auto-end, prediction-auto-close).
Fraud: очередь fraud-review, отдельный процесс worker-fraud.ts.
Не добавляй setInterval в API для бизнес-логики. Идемпотентность в worker handlers обязательна.
Читай docs/MASTER_PROMPT_PRODUCTION.md и docs/AI_AGENT_EVENT_SYSTEM_MASTER.md.
```

---

## Исходный жёсткий ТЗ (требования заказчика)

Ниже — формулировки, от которых отталкивалась реализация:

1. **Race conditions**: worker всегда читает сущность из БД, сверяет статус и время (`endsAt` / `autoCloseAt`), затем действует или перепланирует job.
2. **Idempotency**: повтор job безопасен (`finalizeDropAfterTimer`, `endLiveBroadcast`, `finalizePredictionAutoClose`).
3. **Предикты**: не cron каждые 2 s, а `prediction-auto-close` с `jobId` на prediction; при смене времени — remove + новый job (`schedulePredictionAutoCloseJob`).
4. **WS**: `initial_state` на каждый connect/reconnect; versioning через `seq` / `broadcastSeq`; клиент при пропуске seq делает sync.
5. **Outbox**: таблица + worker drain (минимальный вариант).
6. **Fault tolerance**: retries, backoff, failed jobs не удалять (`removeOnFail: false`).
7. **Reconnect**: клиент сбрасывает ожидание seq до нового `initial_state`, не копит старый state как истину.
8. **Event schema**: см. `DomainBroadcastEvent` в `events/domainEvents.ts`.
9. **Разделение воркеров**: `worker.ts` vs `worker-fraud.ts`.
10. **Логирование**: JSON-строки `jobLog` в worker (start / completed / failed).

---

## Отклонения и компромиссы

- **Outbox не в одной транзакции с доменом** (кроме случаев, где явно расширите): проще эксплуатация, теоретический зазор «БД записана, outbox нет» при kill процесса — маловероятен; при необходимости добавить `tx.insert(outboxEvents)` внутрь доменных транзакций.
- **Персональные события** (`me_update`, `drop_claimed`) по-прежнему идут напрямую в Redis, без outbox и без `seq` (только broadcast fan-out унифицирован).
- **Ленивое закрытие предиктов** на чтении (`syncExpiredPredictions` → `closeExpiredPredictionsNow`) оставлено как подстраховка при сбое delayed job; это не клиентский polling.
