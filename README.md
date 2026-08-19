# Mlaffon

Telegram Mini App for streamer economy: tasks, shop, games, giveaways, predictions, and live drops.

[![License: Proprietary](https://img.shields.io/badge/license-Proprietary-b91c1c)](LICENSE)
[![CI](https://github.com/sssaturX/mlaffon-tg-app/actions/workflows/ci.yml/badge.svg)](https://github.com/sssaturX/mlaffon-tg-app/actions/workflows/ci.yml)

> **This is not open source.** Source is published so the product can be reviewed and maintained. Copying, running, forking for reuse, or shipping a clone is forbidden. See [LICENSE](LICENSE).

Live product: [mlaffon.fun](https://mlaffon.fun)

## Stack

| Part | Tech |
|------|------|
| API | Fastify, Drizzle, PostgreSQL |
| Queue | Redis, BullMQ |
| Web | Vite, React, Telegram Mini App SDK |
| Admin | Vite + React |
| Auth | Telegram initData, JWT, Twitch / Kick OAuth |

Tokens at rest are encrypted (AES-256-GCM). Claim and OAuth routes are rate-limited.

## Repository layout

```
apps/api      REST API, workers, OAuth, economy, shop, tasks
apps/web      Mini App SPA
apps/admin    Admin panel
packages/shared   Shared DTO types
deploy        Caddy / systemd / release scripts
docs          Architecture and operations
```

## Quick start (local)

You need **Node.js 20+** and **Docker** (Postgres + Redis).

```bash
docker compose up -d
npm install
cp .env.example apps/api/.env
```

Fill placeholders in `apps/api/.env`. For a local run without Telegram, `ALLOW_DEV_AUTH=1` plus `JWT_SECRET` and `TOKENS_ENCRYPTION_KEY` is enough.

```bash
cd apps/api
npx drizzle-kit push
npm run db:seed
cd ../..

npm run worker -w api   # separate terminal: task checks, outbox, timers
npm run dev             # API :3001  ·  web :5173  (proxies /api)
```

Without the worker, realtime events stay in `outbox_events` and do not reach Redis / WebSocket.

## Production

- Bot: [@BotFather](https://t.me/BotFather), HTTPS Mini App URL
- Strong `JWT_SECRET`, real `TELEGRAM_BOT_TOKEN`, `ALLOW_DEV_AUTH=0`
- Static web from `apps/web/dist`, admin from `apps/admin/dist`

Server path (Caddy + systemd): [docs/SIMPLE-START.md](docs/SIMPLE-START.md). Also [docs/vps-deploy.md](docs/vps-deploy.md) and [deploy/](deploy/).

## API (short)

| Method | Path |
|--------|------|
| POST | `/api/v1/auth/telegram` |
| POST | `/api/v1/auth/dev` (`ALLOW_DEV_AUTH=1` only) |
| GET | `/api/v1/me` |
| GET | `/api/v1/tasks?platform=` |
| POST | `/api/v1/tasks/:id/claim` |
| GET/POST | `/api/v1/shop/items`, `/purchase` |
| GET | `/api/v1/oauth/twitch/url`, `/api/v1/oauth/kick/url` |
| POST | `/api/v1/account/delete` |

Full map: [docs/api-routes.md](docs/api-routes.md). Game knobs: `apps/api/src/game.config.json`.

## Docs

- Product / TZ status: [docs/TZ-README.md](docs/TZ-README.md)
- Environment: [docs/env-guide.md](docs/env-guide.md)
- Security notes: [docs/security.md](docs/security.md)
- How to report a vuln: [SECURITY.md](SECURITY.md)

## License

Copyright © 2026 Mlaffon. **All rights reserved.**

The code is **source-available**, not MIT/Apache/GPL. You may view this GitHub page. You may **not** copy, modify (except a PR back here), distribute, or use the software without a written license from the copyright holder.

See [LICENSE](LICENSE), [NOTICE](NOTICE), and [CONTRIBUTING.md](CONTRIBUTING.md).
