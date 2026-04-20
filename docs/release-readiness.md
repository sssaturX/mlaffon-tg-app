# Release Readiness Assessment

## Security ✓
- [x] No real secrets in `.env.example`
- [x] Env validation at startup with fail-fast
- [x] JWT signature verified before rate-limit key extraction
- [x] CORS: explicit allowlist (no `origin: true`)
- [x] Admin RBAC: super_admin / moderator / viewer roles
- [x] Admin login via DB-backed bcrypt accounts (not env plaintext comparison)
- [x] All destructive admin actions audit-logged with role, IP, request ID
- [x] Purchase operations fully atomic (single transaction)
- [x] CSP headers on web and admin
- [x] HSTS with preload
- [x] `ALLOW_DEV_AUTH=1` blocked in production
- [x] Default JWT_SECRET blocked in production

## Performance ✓
- [x] Referral N+1 eliminated (JOIN instead of loop)
- [x] Leaderboard queries cached in Redis (60s TTL)
- [x] Weekly referral payout batch-optimized (pre-load all refs)
- [x] Giveaway winner inserts batched
- [x] Redis KEYS replaced with SCAN
- [x] Write-on-read removed from giveaway GET endpoints
- [x] Web push: batched with bounded concurrency (100/batch, 10 concurrent)
- [x] Admin list endpoints paginated with total count
- [x] Indexes added for leaderboard sorts and outbox polling

## Observability ✓
- [x] Sentry error tracking (API + workers)
- [x] Prometheus metrics endpoint (`/metrics`)
- [x] HTTP request duration histogram (per route/method/status)
- [x] BullMQ job duration tracking
- [x] DB pool metrics (existing pgPoolMetrics)
- [x] Event loop lag monitoring
- [x] Structured JSON logging via Fastify/pino
- [x] Slow request logging
- [x] Health endpoints: `/health` (liveness) + `/health/ready` (readiness)
- [x] Global error handler with Sentry capture

## CDN/Edge ✓
- [x] Caddyfile with immutable cache for `/assets/*`
- [x] Cloudflare trusted proxy IPs configured in Caddy
- [x] Cloudflare cache rules documented (static, API, admin)
- [x] WAF rules defined (OWASP, rate limiting, admin protection)
- [x] Origin protection strategy (firewall to Cloudflare IPs only)
- [x] Cache purge strategy documented

## Deployment ✓
- [x] systemd units with memory limits, CPU quotas, proper dependencies
- [x] Graceful shutdown handlers (SIGTERM) for API and workers
- [x] Health-check gated in redeploy.sh
- [x] Post-deploy smoke test script
- [x] CI pipeline (typecheck, test, build, audit, secret scan)
- [x] Rollback procedures documented

## Queues/Workers ✓
- [x] Default job options: 4 attempts, exponential backoff, failed jobs retained
- [x] Giveaway finalization as cron job (30s interval)
- [x] Outbox cleanup as daily cron job
- [x] Worker Sentry integration for failed jobs
- [x] Job duration metrics via Prometheus
- [x] Graceful shutdown with `worker.close()`

## Data Integrity ✓
- [x] Financial ops: idempotency keys on all transactions
- [x] Purchase: debit + stock + inventory in single transaction
- [x] Referral payouts: idempotency key per week/user
- [x] Outbox: FOR UPDATE SKIP LOCKED for reliable event delivery
