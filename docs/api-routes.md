# Справочник HTTP API и моменты вызова

Базовый URL в проде: тот же origin, что у Mini App / сайта (через Caddy). Префикс публичного API: **`/api/v1/`**. Админка: **`/api/admin/`**.

**Авторизация пользователя:** заголовок `Authorization: Bearer <JWT>` (после `POST /api/v1/auth/telegram` или веб login/register).  
**Админка:** отдельный JWT после `POST /api/admin/login` + RBAC по ролям.

Ниже «**когда**» — типичные триггеры: экран приложения, действие пользователя, фоновый процесс или оператор.

---

## Система, деплой, мониторинг

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/health` | Liveness: проверка Postgres + Redis | Kubernetes/systemd health, ручной `curl`, старые скрипты деплоя |
| GET | `/health/ready` | Readiness | `deploy/release.sh`, балансировщики, `deploy/smoke-test.sh` |
| GET | `/version` | Версия билда (commit, release) | Отладка, проверка после деплоя |
| GET | `/metrics` | Prometheus | Сбор метрик с инстанса API |

---

## Публичная главная (без обязательного Bearer)

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/home/public` | Публичный блок главной (FAQ/статистика и т.п.) | CDN/smoke/load-тесты (`deploy/smoke-test.sh`, `warmup.sh`); клиент может не дергать, если данные приходят из других эндпоинтов |
| GET | `/api/v1/home/content` | Контент главной | Загрузка главной в web: `fetchHomeContent` при монтировании/префетче (`apps/web` → `query/fetchers.ts`, `useHomeQueries`) |
| GET | `/api/v1/home/giveaways` | Срез розыгрышей для главной | То же: `fetchHomeGiveaways`, префетч при старте приложения |

---

## Аутентификация и аккаунт

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| POST | `/api/v1/auth/telegram` | Вход по `initData` Telegram WebApp | Первый запуск Mini App / восстановление сессии (`apps/web/src/api.ts`) |
| POST | `/api/v1/auth/register` | Регистрация email + пароль | Экран регистрации веб-клиента |
| POST | `/api/v1/auth/login` | Вход email + пароль | Экран входа веб-клиента |
| POST | `/api/v1/auth/link/telegram` | Выдать сценарий привязки Telegram к веб-аккаунту | Настройки профиля веб (после логина) |
| POST | `/api/v1/auth/dev` | Dev-вход по `telegramId` | Только `NODE_ENV !== production` и `ALLOW_DEV_AUTH=1` |
| POST | `/api/v1/me/web-credentials` | Сохранить учётные данные для веб-части | По запросу фронта (`api.ts`) |
| POST | `/api/v1/account/delete` | Запрос удаления аккаунта | Кнопка в профиле (`Profile.tsx`) |

---

## Профиль, экономика, промо

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/me` | Краткий профиль | React Query / объединённые запросы после логина |
| GET | `/api/v1/me/profile` | Расширенный профиль | `fetchers.ts`: префетч, обновление данных «я» |
| GET | `/api/v1/me/economy` | Балансы монет по платформам | Префетч, экраны с балансом |
| POST | `/api/v1/promo/apply` | Применить промокод | Форма на главной (`Home.tsx`) |

---

## Платформы Twitch / Kick

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/oauth/twitch/url` | URL OAuth Twitch | Кнопка «Подключить Twitch» (`useOAuthLink.ts`) |
| GET | `/api/v1/oauth/twitch/callback` | OAuth redirect от Twitch | Браузер после авторизации на стороне Twitch |
| GET | `/api/v1/oauth/kick/url` | URL OAuth Kick | Кнопка «Подключить Kick» |
| GET | `/api/v1/oauth/kick/callback` | OAuth redirect от Kick | Браузер после авторизации Kick |
| POST | `/api/v1/platforms/:platform/connect` | Заглушка привязки | Только dev (`useOAuthLink` при отсутствии реального OAuth) |
| DELETE | `/api/v1/platforms/:platform` | Отвязать `twitch` или `kick` | Профиль → отвязка (`Profile.tsx`) |

---

## Задания (tasks) и платформа

Query **`platform`**: `twitch` | `kick` | `all` — фильтр списка под активную платформу приложения.

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/tasks?platform=…` | Список заданий с прогрессом | Открытие вкладки заданий, префетч (`fetchers.fetchTasks`) |
| POST | `/api/v1/tasks/:id/claim?platform=…` | Забрать награду | Кнопка «Получить» у задания (`Tasks.tsx`). Возможен **202** + асинхронная проверка |
| POST | `/api/v1/tasks/stream-message` | Отправить сообщение в чат (задания типа «сообщение в стрим») | При отправке текста из UI задания (если экран подключён к этому API) |
| POST | `/api/v1/tasks/:id/evidence` | Загрузка доказательств (фото и т.д.) | Пользователь прикрепляет доказательства (`Tasks.tsx`) |

---

## Колесо фортуны

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/games/fortune` | Краткий статус фортуны | Опционально; в web основной поток — `config` + `state` |
| GET | `/api/v1/games/fortune/config` | Конфиг колеса (сектора); **без JWT** (публичный ответ из `gameConfig`) | Экран «Игры», префетч (`useFortuneConfig`, `prefetch.ts`) |
| GET | `/api/v1/games/fortune/state` | Состояние на сейчас (спины, лимиты) | Экран «Игры» (`useFortuneState`) |
| POST | `/api/v1/games/fortune/spin` | Вращение: `platform`, `mode` free/paid | Нажатие «Крутить» на колесе (`Games.tsx`) |

---

## Магазин

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/shop/items?platform=twitch\|kick` | Витрина + глобальные тексты | Открытие страницы магазина (`Shop.tsx`, React Query) |
| POST | `/api/v1/shop/purchase` | Покупка товара | Подтверждение покупки в модалке (`Shop.tsx`) |

---

## Лидерборд и рефералы

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/leaderboard?sort=&platform=` | Топ + позиция пользователя | Экран лидерборда (если включён в навигации), `fetchLeaderboard` |
| GET | `/api/v1/referrals` | Реферальная статистика и список | Префетч / экран рефералов (`fetchers`) |

---

## Розыгрыши, дропы, предсказания

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/giveaways` | Публичный список розыгрышей | Список розыгрышей, префетч |
| GET | `/api/v1/giveaways/:id` | Детали розыгрыша | Карточка / страница розыгрыша |
| POST | `/api/v1/giveaways/:id/join` | Участие: `platform` | Кнопка «Участвовать» (`Giveaway.tsx`) |
| GET | `/api/v1/drops/active` | Активный дроп | HTTP-режим; при realtime часть данных может приходить только по WebSocket (см. `wsOnlyQueryFns.ts`) |
| POST | `/api/v1/drops/attempt` | Проверка кода дропа | Ввод кода в оверлее (`DropOverlay.tsx`) |
| GET | `/api/v1/predictions/active` | Активное предсказание | HTTP или WS в зависимости от режима |
| POST | `/api/v1/predictions/:id/bet` | Ставка | Главная: блок предсказания (`Home.tsx`) |

---

## Эфир, бан, медиа, push

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| GET | `/api/v1/live-broadcast` | Текущий эфир / настройки награды | Загрузка карточки эфира (данные могут дублироваться/дополняться WS) |
| POST | `/api/v1/live-broadcast/watch` | Отметка просмотра, streak, бонус | Нажатие CTA «Посмотреть» / подтверждение просмотра (`Home.tsx`) |
| POST | `/api/v1/ban-appeal` | Апелляция бана | Экран бана (`BannedScreen.tsx`) |
| POST | `/api/v1/media/images` | Загрузка изображения пользователем | Multipart из клиента (задания с фото и т.д.) |
| GET | `/api/v1/push/vapid-public-key` | Публичный VAPID для Web Push | Перед подпиской на push (`webPushClient.ts`) |
| POST | `/api/v1/push/subscribe` | Сохранить подписку push | После `subscribe()` в браузере |
| DELETE | `/api/v1/push/subscribe` | Отписка по `endpoint` | Отключение уведомлений |

---

## Realtime

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| POST | `/api/v1/ws-ticket` | Одноразовый `ticket` для WebSocket | Перед открытием WS (`useRealtimeWebSocket.ts`) |
| GET | `/api/v1/ws` | WebSocket upgrade `?ticket=` | Сразу после получения ticket; дальше события баланса, дропы и т.д. |

---

## Telegram (сервер)

| Метод | Путь | Назначение | Когда вызывается |
|-------|------|------------|------------------|
| POST | `/api/v1/telegram/webhook` | Входящие апдейты бота | Telegram Bot API шлёт на настроенный webhook URL |

---

## Админка `/api/admin/*`

Все маршруты — после **админского JWT** (кроме логина). Конкретные права зависят от роли (`read:*`, `admin:manage_shop`, …).

### Вход и обзор

| Метод | Путь | Когда |
|-------|------|--------|
| POST | `/api/admin/login` | Отправка формы входа в админку |
| GET | `/api/admin/me` | Проверка сессии после логина |
| GET | `/api/admin/stats` | Шапка дашборда, авто-обновление по таймеру (`App.tsx`) |

### Пользователи

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/users` | Список пользователей (вкладка, фильтры) |
| PATCH | `/api/admin/users/:id` | Редактирование пользователя из модалки |
| DELETE | `/api/admin/users/:id` | Удаление пользователя |
| POST | `/api/admin/users/:id/balance` | Корректировка баланса |
| DELETE | `/api/admin/users/:id/platforms/twitch` | Снятие привязки Twitch |
| DELETE | `/api/admin/users/:id/platforms/kick` | Снятие привязки Kick |
| GET | `/api/admin/users/:id/referrals` | Рефералы выбранного пользователя |

### Розыгрыши и промокоды

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/giveaways` | Список розыгрышей |
| POST | `/api/admin/giveaways` | Создание розыгрыша |
| GET | `/api/admin/giveaways/:id` | Детали |
| DELETE | `/api/admin/giveaways/:id` | Удаление |
| POST | `/api/admin/giveaways/:id/draw` | Провести розыгрыш |
| GET | `/api/admin/promos` | Список промокодов |
| POST | `/api/admin/promos` | Создание промокода |

### Дропы

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/drops` | Активные/настройки дропов |
| GET | `/api/admin/drops/history` | История |
| GET | `/api/admin/drops/:id/claimants` | Кто забрал дроп |
| POST | `/api/admin/drops/start` | Запуск дропа |

### Задания и доказательства

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/tasks` | Каталог заданий |
| POST | `/api/admin/tasks` | Создание задания |
| PUT | `/api/admin/tasks/:id` | Редактирование |
| DELETE | `/api/admin/tasks/:id` | Удаление |
| PATCH | `/api/admin/tasks/:id/toggle` | Вкл/выкл задание |
| GET | `/api/admin/tasks/evidence` | Очередь доказательств |
| PATCH | `/api/admin/tasks/evidence/:id` | Модерация доказательства |

### Магазин и тексты витрины

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/shop/items` | Список товаров |
| POST | `/api/admin/shop/items` | Создание товара |
| PUT | `/api/admin/shop/items/:id` | Редактирование |
| DELETE | `/api/admin/shop/items/:id` | Удаление (ограничения по FK к покупкам — см. API) |
| GET | `/api/admin/shop/purchases` | История покупок |
| GET | `/api/admin/shop/global-copy` | Глобальные тексты магазина |
| PUT | `/api/admin/shop/global-copy` | Сохранение текстов |

### Медиа (админ)

| Метод | Путь | Когда |
|-------|------|--------|
| POST | `/api/admin/media/images` | Загрузка картинки для карточек/админки (multipart) |

### Бан-апелляции

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/ban-appeals` | Список апелляций |
| PATCH | `/api/admin/ban-appeals/:id` | Рассмотрение апелляции |

### Эфир (админ)

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/live-broadcast` | Текущее состояние эфира |
| POST | `/api/admin/live-broadcast/start` | Старт эфира |
| POST | `/api/admin/live-broadcast/end` | Завершение эфира |

### Предсказания (админ)

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/predictions/platforms` | Настройки платформ |
| PATCH | `/api/admin/predictions/platforms/:type` | Обновление настроек |
| POST | `/api/admin/predictions` | Создание раунда |
| GET | `/api/admin/predictions` | Список |
| GET | `/api/admin/predictions/:id` | Детали |
| PATCH | `/api/admin/predictions/:id/start` | Старт |
| PATCH | `/api/admin/predictions/:id/pause` | Пауза |
| PATCH | `/api/admin/predictions/:id/close` | Закрытие приёма ставок |
| PATCH | `/api/admin/predictions/:id/resolve` | Исход |

### Администраторы и аудит

| Метод | Путь | Когда |
|-------|------|--------|
| GET | `/api/admin/admins` | Список админов |
| POST | `/api/admin/admins` | Приглашение / создание |
| PATCH | `/api/admin/admins/:id/role` | Смена роли |
| DELETE | `/api/admin/admins/:id` | Удаление админа |
| GET | `/api/admin/audit-log` | Журнал действий |

---

## Примечания

1. **Кэш и CDN:** публичные GET с `Cache-Control: public` могут кэшироваться CDN; персональные — `private` / `no-store`. См. `docs/cdn-edge.md`, `docs/cache-strategy.md`.
2. **OAuth callback** (`/oauth/.../callback`) вызывается **браузером** редиректом, не из SPA fetch напрямую.
3. **WebSocket** после upgrade не считается «HTTP роутом» в привычном смысле, но endpoint один: `GET /api/v1/ws`.
4. Актуальный список путей всегда можно сверить с кодом: `apps/api/src/index.ts`, `apps/api/src/routes/*.ts`, `apps/api/src/plugins/auth.ts` (исключения для `/health`, `/ws`).
