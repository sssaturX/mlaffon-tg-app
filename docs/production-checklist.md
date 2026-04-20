# Production Launch Checklist

## Pre-Launch

### Infrastructure
- [ ] VPS provisioned (2+ CPU, 4+ GB RAM minimum)
- [ ] PostgreSQL 16 installed and configured
- [ ] Redis 7 installed and configured
- [ ] Caddy 2 installed
- [ ] Node.js 20 LTS installed
- [ ] Firewall configured (Cloudflare IPs only on 80/443)

### DNS & CDN
- [ ] Cloudflare account created
- [ ] Domain added to Cloudflare
- [ ] DNS records: `mlaffon.fun` → VPS IP (proxied)
- [ ] DNS records: `admin.mlaffon.fun` → VPS IP (proxied)
- [ ] SSL/TLS mode: Full (Strict)
- [ ] HSTS enabled
- [ ] Brotli compression enabled
- [ ] Cache rules configured per `deploy/cloudflare-rules.md`
- [ ] WAF OWASP rules enabled
- [ ] Admin login rate limit rule active

### Secrets & Configuration
- [ ] `apps/api/.env` created from `.env.example`
- [ ] `JWT_SECRET` generated: `openssl rand -hex 32`
- [ ] `ADMIN_JWT_SECRET` generated: `openssl rand -hex 32`
- [ ] `TOKENS_ENCRYPTION_KEY` generated: `openssl rand -base64 32`
- [ ] `TELEGRAM_BOT_TOKEN` set
- [ ] `TWITCH_CLIENT_ID/SECRET` set
- [ ] `KICK_CLIENT_ID/SECRET` set
- [ ] `NODE_ENV=production` set
- [ ] `CORS_ORIGINS` set to production domains
- [ ] `PUBLIC_WEB_URL` set
- [ ] `PUBLIC_ADMIN_URL` set
- [ ] `SENTRY_DSN` set (from Sentry project)
- [ ] VAPID keys generated for web push
- [ ] `ALLOW_DEV_AUTH` is NOT set / is 0

### Database
- [ ] Database created
- [ ] All migrations applied (through 0005)
- [ ] Default admin seeded (via `ADMIN_EMAIL/PASSWORD/PASSPHRASE` env)
- [ ] Connection pool sized appropriately (`PG_POOL_MAX`)

### Build & Deploy
- [ ] `npm ci` completed
- [ ] `npm run build` successful
- [ ] Caddyfile deployed: `sudo cp deploy/Caddyfile /etc/caddy/Caddyfile`
- [ ] Caddy validated: `sudo caddy validate`
- [ ] systemd units installed
- [ ] Services enabled and started

## Launch Verification

### Smoke Tests
- [ ] `./deploy/smoke-test.sh https://mlaffon.fun` — all pass
- [ ] Admin login works at `https://admin.mlaffon.fun`
- [ ] WebSocket connects via `wss://mlaffon.fun/api/v1/ws`

### CDN Verification
- [ ] `curl -I https://mlaffon.fun/assets/index-*.js` → `cf-cache-status: HIT`
- [ ] `curl -I https://mlaffon.fun/api/v1/home/public` → correct Cache-Control
- [ ] `curl -I https://mlaffon.fun/api/v1/me` → no edge caching
- [ ] Direct VPS IP access returns block/timeout (Cloudflare only)

### Observability
- [ ] Sentry receiving events (trigger a test error)
- [ ] `/metrics` endpoint returning Prometheus data
- [ ] `/health` and `/health/ready` both return 200
- [ ] Worker logs appearing in journal

### Security
- [ ] Rate limiting working (verify 429 on burst)
- [ ] Admin auth requires all three factors
- [ ] Viewer role cannot access destructive endpoints (returns 403)
- [ ] Audit log captures admin actions

## Post-Launch

### First Hour
- [ ] Monitor Sentry for unexpected errors
- [ ] Monitor logs: `journalctl -u mlaffon-api -f`
- [ ] Monitor worker: `journalctl -u mlaffon-worker -f`
- [ ] Verify no 5xx responses in Cloudflare analytics

### First Day
- [ ] Review Prometheus metrics for latency baselines
- [ ] Confirm queue processing is healthy (no growing backlog)
- [ ] Review admin audit log for any unexpected actions
- [ ] Set up external uptime monitoring (e.g., Cloudflare Health Checks)

### First Week
- [ ] Document baseline p95/p99 latencies
- [ ] Review and tune cache TTLs based on traffic patterns
- [ ] Review Sentry error groupings, ignore expected business errors
- [ ] Configure alerting rules based on baseline metrics
