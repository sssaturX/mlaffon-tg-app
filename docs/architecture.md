# Architecture Overview

## System Diagram

```
                    ┌──────────────────┐
                    │   Cloudflare     │  DDoS, WAF, edge cache
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │     Caddy        │  TLS, static files, reverse proxy
                    └────┬────────┬────┘
                         │        │
              ┌──────────┘        └──────────┐
              │                              │
    ┌─────────┴──────────┐        ┌──────────┴─────────┐
    │  Fastify API       │        │  Static Files       │
    │  (Node.js)         │        │  (web/admin dist)   │
    │  port 3001         │        │                     │
    └────┬───┬───┬───────┘        └─────────────────────┘
         │   │   │
    ┌────┘   │   └────┐
    │        │        │
┌───┴───┐ ┌──┴──┐ ┌──┴──────┐
│  PG   │ │Redis│ │BullMQ   │
│  16   │ │  7  │ │Workers  │
└───────┘ └─────┘ └─────────┘
```

## Stack

| Layer | Technology |
|---|---|
| Frontend (Web) | React 18 + Vite 6 + React Router 7 + TanStack Query |
| Frontend (Admin) | React 18 + Vite 6 |
| API Server | Fastify 5 + TypeScript + Zod |
| ORM | Drizzle ORM (PostgreSQL driver) |
| Database | PostgreSQL 16 |
| Cache/PubSub | Redis 7 (ioredis) |
| Job Queue | BullMQ |
| File Storage | S3-compatible (via @aws-sdk/client-s3) |
| Image Processing | Sharp (AVIF/WebP/JPEG + LQIP) |
| Reverse Proxy | Caddy 2 |
| CDN/WAF | Cloudflare |

## Monorepo Structure

```
├── apps/
│   ├── api/           # Backend: Fastify API + BullMQ workers
│   ├── web/           # Frontend: Telegram Mini App (React)
│   └── admin/         # Admin panel (React)
├── packages/
│   └── shared/        # Shared TypeScript types
├── deploy/            # Caddyfile, systemd units
├── docs/              # Production documentation
└── .github/workflows/ # CI pipeline
```

## Request Flow

### User Request
```
Client → Cloudflare → Caddy → Fastify
  ↓ auth plugin (JWT verify)
  ↓ rate limit check (per-user or per-IP)
  ↓ route handler
  ↓ service layer (business logic)
  ↓ → Redis cache check
  ↓ → PostgreSQL query (via Drizzle)
  ↓ response with Cache-Control headers
```

### Admin Request
```
Admin UI → Cloudflare → Caddy → Fastify
  ↓ requireAdmin (admin JWT verify)
  ↓ rate limit check
  ↓ route handler
  ↓ service layer
  ↓ → PostgreSQL mutation
  ↓ → audit log write (async)
  ↓ → cache invalidation
  ↓ response
```

### Background Jobs
```
BullMQ Queue → Worker
  ├── task-verify:     async task validation (Twitch/Kick API checks)
  ├── cron:
  │   ├── outbox-flush:         500ms  — push events to Redis PubSub
  │   ├── giveaway-finalize:    30s    — close expired giveaways
  │   ├── weekly-referral:      weekly — payout L1/L2 referral %
  │   └── outbox-cleanup:       daily  — prune old published events
  └── domain-timers:
      ├── drop-end:              scheduled drop finalization
      ├── live-auto-end:         auto-end broadcast after timeout
      └── prediction-auto-close: auto-close prediction betting
```

## Database Tables (key)

| Table | Purpose |
|---|---|
| users | User profiles, Telegram/email identity |
| user_balances | Denormalized coin balances (twitch/kick/total) |
| transactions | Immutable ledger with idempotency keys |
| referrals | Referrer→referee relationships |
| giveaways | Giveaway definitions + draw state |
| predictions | Prediction markets |
| tasks / user_tasks | Task catalog + per-user progress |
| shop_items / shop_purchases | Shop catalog + purchase history |
| admin_audit_log | Admin action audit trail |
| outbox_events | Transactional outbox for realtime events |
| push_subscriptions | Web Push (VAPID) subscriptions |
