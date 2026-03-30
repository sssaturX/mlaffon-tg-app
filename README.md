# Mlaffon — Telegram Mini App (MVP)

Монорепозиторий: **Fastify + Drizzle + PostgreSQL** (API), **Redis + BullMQ** (очередь проверок заданий), **Vite + React** (мини-приложение) с SDK Telegram.

Интеграции: **Twitch OAuth + Helix**, **Kick OAuth + PKCE** (API с fallback), **шифрование токенов** (AES-256-GCM), **rate limits** на claim и OAuth callback.

## Требования

- Node.js 20+
- Docker (Postgres + Redis) или свои инстансы

## Быстрый старт

1. Поднимите Postgres и Redis:

```bash
docker compose up -d
```

2. Установите зависимости из корня:

```bash
npm install
```

3. Скопируйте окружение для API:

```bash
cp .env.example apps/api/.env
```

(На Windows в PowerShell: `copy .env.example apps\api\.env`.)

Отредактируйте `apps/api/.env`: для локальной разработки без бота оставьте `ALLOW_DEV_AUTH=1` и любой `JWT_SECRET`. Задайте `TOKENS_ENCRYPTION_KEY` (например 64 hex-символа) и `REDIS_URL`. Для Twitch/Kick укажите OAuth-клиенты и **точно такие же** redirect URI в консолях разработчика, как в `.env`.

4. Примените схему БД и сиды:

```bash
cd apps/api
npx drizzle-kit push
npm run db:seed
cd ../..
```

5. Запуск **воркера** очереди (отдельный терминал):

```bash
npm run worker -w api
```

6. Запуск API и веба:

```bash
npm run dev
```

- API: `http://localhost:3001`
- Web: `http://localhost:5173` (прокси `/api` → API)

В браузере без Telegram при `ALLOW_DEV_AUTH=1` фронт в dev-режиме вызовет `/api/v1/auth/dev` и создаст тестового пользователя.

**На сервере** отдельные терминалы не обязательны: **Docker** (`docker compose up -d`) работает в фоне; API и воркер запускаются через **systemd** (два сервиса). См. [docs/vps-deploy.md](docs/vps-deploy.md).

### Задания с `validation_type: api`

Начисление идёт **асинхронно**: `POST /tasks/:id/claim` отвечает **202** со статусом `pending`, воркер дергает Helix/Kick и при успехе начисляет монеты. Нужен запущенный `npm run worker -w api` и Redis.

## Продакшен (Telegram)

1. Создайте бота у [@BotFather](https://t.me/BotFather), включите Mini App, укажите URL фронта (HTTPS).
2. Задайте `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, сильный `JWT_SECRET`, отключите `ALLOW_DEV_AUTH`.
3. Соберите фронт и отдайте статику через CDN или вместе с API.

Деплой на VPS: **`git clone` / `git pull`**, сборка на сервере, Docker только для Postgres/Redis, Node + **systemd** + **Nginx** или **Caddy** — [docs/vps-deploy.md](docs/vps-deploy.md). Пример **Caddy** для домена (в т.ч. `mlaffon.fun`): [docs/caddy-mlaffon.md](docs/caddy-mlaffon.md).

## Структура

- `apps/api` — REST API, OAuth Twitch/Kick, Helix, шифрование токенов, BullMQ-воркер проверок заданий, экономика, лидерборд, рефералы, игры, магазин.
- `apps/web` — SPA: главная, задания, игры, магазин, топ, профиль.
- `packages/shared` — общие типы DTO.

## API (кратко)

| Метод | Путь |
|--------|------|
| POST | `/api/v1/auth/telegram` |
| POST | `/api/v1/auth/dev` (только `ALLOW_DEV_AUTH=1`) |
| GET | `/api/v1/me` |
| POST | `/api/v1/stream-streak/claim` |
| GET | `/api/v1/tasks?platform=` |
| POST | `/api/v1/tasks/:id/claim` |
| GET | `/api/v1/leaderboard?sort=&platform=` |
| GET | `/api/v1/referrals` |
| GET | `/api/v1/oauth/twitch/url`, `/api/v1/oauth/kick/url` (Bearer) |
| GET | `/api/v1/oauth/twitch/callback`, `/api/v1/oauth/kick/callback` (браузер) |
| POST | `/api/v1/platforms/:platform/connect` (только `ALLOW_DEV_AUTH=1`, stub) |
| DELETE | `/api/v1/platforms/:platform` |
| GET/POST | `/api/v1/games/fortune`, `/spin` |
| GET/POST | `/api/v1/shop/items`, `/purchase` |
| POST | `/api/v1/account/delete` |

Игровые коэффициенты и награды: `apps/api/src/game.config.json`.

Правила API-заданий (Helix follow/subscription, Kick follow): поле `tasks.meta` в БД, см. `apps/api/src/taskMeta.ts` и сид `apps/api/src/seed.ts`.
