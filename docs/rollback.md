# Rollback Procedures

## Application Rollback

### Quick rollback (to previous release)

```bash
./deploy/rollback.sh
```

This atomically switches the `current` symlink to the `previous` release, reinstalls systemd units, restarts all services, and verifies health.

### Rollback to a specific release

```bash
# List available releases
./deploy/status.sh

# Rollback to a specific release
./deploy/rollback.sh 20260420_143022_abc1234
```

### What rollback.sh does

1. Switches `current` symlink to the target release
2. Saves the current (failing) release as `previous`
3. Copies systemd units from the target release
4. Runs `systemctl daemon-reload`
5. Restarts `mlaffon-api`, `mlaffon-worker`, `mlaffon-worker-fraud`
6. Waits for `/health/ready` (30s timeout)
7. Runs smoke tests
8. Reloads Caddy with the target release's Caddyfile
9. Records the rollback in deploy history

### Auto-rollback (during deploy)

If `release.sh` detects a failure **after the symlink switch** (health check or smoke test), it automatically:
1. Reverts `current` → `previous`
2. Restarts all services
3. Verifies the previous release is healthy
4. Logs the rollback event

### Manual rollback (legacy method)

If the new pipeline is not available:

```bash
# Switch symlink manually
ln -sfn /opt/mlaffon/releases/<known-good-id> /opt/mlaffon/current

# Restart services
sudo systemctl daemon-reload
sudo systemctl restart mlaffon-api mlaffon-worker mlaffon-worker-fraud

# Verify
curl -s http://localhost:3001/health | jq .
```

## Database Rollback

### Migration rollback

Drizzle does not auto-generate down migrations. Migrations are **additive only** by default (new columns/tables/indexes), so code rollback alone is usually sufficient — old code simply ignores new schema additions.

For destructive changes that need reverting:

```sql
-- Example: rollback 0004_admin_audit_log.sql
DROP TABLE IF EXISTS admin_audit_log;
DROP INDEX IF EXISTS outbox_events_unpublished_idx;
DROP INDEX IF EXISTS user_balances_coins_idx;
DROP INDEX IF EXISTS user_balances_twitch_coins_idx;
DROP INDEX IF EXISTS user_balances_kick_coins_idx;
DROP INDEX IF EXISTS giveaways_pending_draw_idx;
```

**Warning**: Only drop indexes if the application code doesn't depend on them.
New indexes are always additive and safe to keep.

### Restore from backup

Pre-deploy backups are automatically created by the pipeline:

```bash
# Find the pre-deploy backup
ls -la /opt/mlaffon/shared/backups/mlaffon_predeploy_*.dump

# Restore using restore.sh
./deploy/restore.sh /opt/mlaffon/shared/backups/mlaffon_predeploy_<sha>_<timestamp>.dump
```

## CDN Rollback

Cache purge is provider-aware via `CDN_PROVIDER` env var (set in shared env):

```bash
# Targeted purge (recommended after rollback)
./deploy/purge-cdn.sh /index.html /

# Full purge (emergency only)
./deploy/purge-cdn.sh --all

# Verify CDN state after purge
./deploy/verify-cdn.sh
```

### CDN bypass (emergency)

If CDN itself is causing issues:
1. Set `CDN_PROVIDER=none` in `/opt/mlaffon/shared/env`
2. Update DNS to point directly to server IP (bypass CDN)
3. Re-enable later by restoring CNAME records and setting `CDN_PROVIDER=yandex`

## Redis Rollback

If Redis cache is corrupted:

```bash
redis-cli FLUSHDB
# Safe: all caches rebuild naturally from DB
```

## Incident Checklist

1. Identify the failing component (API, worker, DB, Redis, CDN)
2. Run `./deploy/status.sh` to see the full picture
3. Check `/health` and `/health/ready` endpoints
4. Check logs: `journalctl -u mlaffon-api -n 100`
5. **If API failed after deploy**: `./deploy/rollback.sh` (automatic rollback to previous)
6. If API is down for other reasons: `sudo systemctl restart mlaffon-api`
7. If worker is stuck: `sudo systemctl restart mlaffon-worker`
8. If DB is unreachable: check PostgreSQL service and Docker
9. If Redis is down: restart Redis; app degrades gracefully (cache misses)
10. If CDN issue: `./deploy/purge-cdn.sh --all` or bypass CDN (set `CDN_PROVIDER=none`, switch DNS to origin)
11. Document the incident and resolution
