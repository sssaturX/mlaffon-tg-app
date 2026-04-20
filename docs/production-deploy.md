# Production Deployment Guide

## Prerequisites
- VPS with Ubuntu 22+ (2+ CPU, 4+ GB RAM recommended)
- PostgreSQL 16+
- Redis 7+
- Caddy 2+
- Node.js 20+
- Cloudflare account (recommended for CDN/DDoS protection)

## Environment Setup

1. Copy env template:
   ```bash
   cp .env.example apps/api/.env
   ```

2. Generate secrets:
   ```bash
   # JWT secret
   openssl rand -hex 32
   # Encryption key
   openssl rand -base64 32
   # Admin JWT secret
   openssl rand -hex 32
   ```

3. Fill in all required vars in `apps/api/.env`
4. Set `NODE_ENV=production`

## Database

```bash
npm run db:migrate --workspace=apps/api
```

Run new migration:
```bash
psql $DATABASE_URL < apps/api/drizzle/0004_admin_audit_log.sql
```

## Build

```bash
npm ci
npm run build
```

## Deploy

```bash
# Copy Caddyfile
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy

# Start services
sudo systemctl enable --now mlaffon-api mlaffon-worker
```

## Health Checks

- Liveness: `GET /health` — returns `{ ok, checks: { db, redis } }`
- Readiness: `GET /health/ready` — 200 if all deps up, 503 otherwise

## Rollback

```bash
git checkout <previous-tag>
npm ci && npm run build
sudo systemctl restart mlaffon-api mlaffon-worker
```

## Secret Rotation

1. Generate new secret
2. Update `apps/api/.env`
3. Restart API: `sudo systemctl restart mlaffon-api`
4. For JWT_SECRET: existing sessions expire naturally (7d for users, 8h for admin)
