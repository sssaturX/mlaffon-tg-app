# Security Architecture

## Authentication

### User Auth
- JWT signed with `JWT_SECRET` (HS256), 7-day expiry
- Issued on Telegram initData verification or email/password login
- Stored in `localStorage` (acceptable for Telegram Mini App context)
- Rate-limit key generator verifies JWT signature before extracting `sub`

### Admin Auth
- Separate JWT signed with `ADMIN_JWT_SECRET`, 8-hour expiry
- Three-factor: email + password + passphrase
- Admin routes use `requireAdmin` middleware on `/api/admin/*` prefix
- Admin JWT is completely separate from user JWT

### WebSocket Auth
- One-time ticket stored in Redis (25s TTL)
- `POST /api/v1/ws-ticket` → get ticket → `ws://…/api/v1/ws?ticket=…`
- Ticket consumed on connection; replay impossible

## Authorization
- All user-scoped queries use `userId` from verified JWT, not from request params
- Admin routes check `requireAdmin` before any operation
- Banned users get 403 on most routes; `ban-appeal` is allowed

## Secrets Management
- All secrets in `apps/api/.env` (never committed)
- `.env.example` contains only placeholders
- Env validation at startup prevents boot with missing secrets
- Production env checked for `NODE_ENV=production`, `CORS_ORIGINS`, no `ALLOW_DEV_AUTH`

## CORS Policy
- Production: explicit allowlist from `CORS_ORIGINS` env
- Development: localhost:5173 + localhost:5174 (never `origin: true`)
- Credentials: true (required for Bearer auth flow)

## Rate Limiting
- Global: 200 req/min per user (JWT-verified) or per IP
- Per-route: stricter limits on auth, fortune, giveaway, prediction, drop endpoints
- Redis-based abuse counters for claims, OAuth callbacks, web registrations
- WebSocket: connection-level throttling

## Admin Audit
- All destructive admin actions logged to `admin_audit_log` table
- Fields: admin_email, action, entity_type, entity_id, payload, IP, timestamp
- Audited actions: delete_user, adjust_balance, draw_giveaway, resolve_prediction

## Content Security
- CSP headers on both web and admin
- HSTS with preload
- X-Content-Type-Options: nosniff
- Admin: X-Frame-Options: DENY
- Web: frame-ancestors for Telegram

## Dev-only Routes
- `/api/v1/auth/dev` and `/api/v1/platforms/:platform/connect` (stub)
- Only registered when `NODE_ENV !== "production" && ALLOW_DEV_AUTH === "1"`
- Env validation blocks `ALLOW_DEV_AUTH=1` in production

## Financial Safety
- All balance operations use idempotency keys (unique constraint on `transactions.idempotency_key`)
- `applyDebit` checks balance inside transaction before deducting
- `purchaseItem` is fully atomic (debit + stock + inventory + purchase record in one transaction)
- Duplicate detection via idempotency key prevents double-spend
