# Deploy Runbooks

Failure scenario guides for the mlaffon deploy pipeline.

---

## Scenario: Preflight Failure

**Symptoms**: `release.sh` exits at step 2 with "Preflight FAILED"

**Impact**: None — no changes made to the system

**Resolution**:
1. Read the preflight output to identify the failing check
2. Common fixes:
   - **Disk space**: Clean old releases or backups
     ```bash
     ./deploy/status.sh  # check disk usage
     # Manually remove old releases if needed
     ls -la /opt/mlaffon/releases/
     ```
   - **Missing tool**: Install the required package (`psql`, `jq`, etc.)
   - **DB unreachable**: Check PostgreSQL/Docker
     ```bash
     docker compose -f /opt/mlaffon/repo/docker-compose.yml ps
     docker compose -f /opt/mlaffon/repo/docker-compose.yml up -d postgres
     ```
   - **Redis unreachable**: Check Redis/Docker
     ```bash
     redis-cli -u "$(grep REDIS_URL /opt/mlaffon/shared/env | cut -d= -f2-)" ping
     ```
   - **Env validation**: Fix `/opt/mlaffon/shared/env`

---

## Scenario: Build Failure

**Symptoms**: `release.sh` exits at step 7 or 8

**Impact**: None — incomplete release dir is cleaned up, old release untouched

**Resolution**:
1. Check the build log in `/opt/mlaffon/shared/logs/deploy-*.log`
2. Common causes:
   - TypeScript errors: Fix in code, push, re-tag
   - Missing dependencies: Check `package.json` changes
   - Out of memory: Check available RAM
     ```bash
     free -m
     # Increase Node memory limit if needed
     export NODE_OPTIONS="--max-old-space-size=2048"
     ```
3. Fix the issue, create a new tag, and redeploy

---

## Scenario: Migration Failure

**Symptoms**: `release.sh` exits at step 10 with "Migration failed after retries"

**Impact**: None — old release still active (symlink not switched)

**Resolution**:
1. Check the migration error in the deploy log
2. Common causes:
   - **Column conflict**: Schema already has the column (safe to skip)
     ```bash
     DEPLOY_SKIP_MIGRATIONS=1 ./deploy/release.sh v1.2.3
     ```
   - **Destructive change**: Requires explicit opt-in
     ```bash
     DEPLOY_ALLOW_DESTRUCTIVE=1 ./deploy/release.sh v1.2.3
     ```
   - **DB connection issue**: Check PostgreSQL
   - **Lock timeout**: Another process holds a lock
     ```bash
     psql "$DATABASE_URL" -c "SELECT * FROM pg_locks WHERE NOT granted;"
     ```

---

## Scenario: Health Check Failure (Post-Switch)

**Symptoms**: `release.sh` triggers auto-rollback at step 14

**Impact**: Symlink was switched but API didn't start. **Auto-rollback activates.**

**What happens automatically**:
1. `current` symlink reverts to `previous`
2. All services restart
3. Health check verifies previous release

**If auto-rollback succeeds**:
- System is back on the previous release
- Investigate the failure:
  ```bash
  journalctl -u mlaffon-api -n 100
  cat /opt/mlaffon/shared/logs/deploy-*.log | tail -50
  ```

**If auto-rollback fails** (CRITICAL):
1. Check API logs immediately:
   ```bash
   journalctl -u mlaffon-api -n 50
   ```
2. Try manual restart:
   ```bash
   sudo systemctl restart mlaffon-api
   ```
3. Check env file:
   ```bash
   cat /opt/mlaffon/shared/env | head -5
   ls -la /opt/mlaffon/current/apps/api/.env
   ```
4. If env symlink is broken:
   ```bash
   ln -sfn /opt/mlaffon/shared/env /opt/mlaffon/current/apps/api/.env
   sudo systemctl restart mlaffon-api
   ```

---

## Scenario: Smoke Test Failure (Post-Switch)

**Symptoms**: `release.sh` triggers auto-rollback at step 16

**Impact**: API is running but some endpoints are failing. **Auto-rollback activates.**

**Resolution** (after auto-rollback):
1. Check which smoke tests failed:
   ```bash
   /opt/mlaffon/current/deploy/smoke-test.sh http://localhost:3001
   ```
2. Common causes:
   - Missing database data (migration ran but seed didn't)
   - Redis cache issues
   - Route handler error
3. Check API logs:
   ```bash
   journalctl -u mlaffon-api --since "5 min ago"
   ```

---

## Scenario: Worker Not Starting

**Symptoms**: `mlaffon-worker` or `mlaffon-worker-fraud` is inactive after deploy

**Impact**: Background jobs queue up but don't process

**Resolution**:
1. Check worker logs:
   ```bash
   journalctl -u mlaffon-worker -n 50
   journalctl -u mlaffon-worker-fraud -n 50
   ```
2. Verify the worker entry point exists:
   ```bash
   ls -la /opt/mlaffon/current/apps/api/dist/worker.js
   ls -la /opt/mlaffon/current/apps/api/dist/worker-fraud.js
   ```
3. Restart manually:
   ```bash
   sudo systemctl restart mlaffon-worker
   sudo systemctl restart mlaffon-worker-fraud
   ```
4. Check Redis connectivity (workers need Redis for BullMQ):
   ```bash
   redis-cli -u "$(grep REDIS_URL /opt/mlaffon/shared/env | cut -d= -f2-)" ping
   ```

---

## Scenario: Stale Deploy Lock

**Symptoms**: "Another deploy is in progress" but no deploy is running

**Resolution**:
1. Check if the holding process is alive:
   ```bash
   cat /opt/mlaffon/shared/.deploy.lock.pid
   ps -p $(cat /opt/mlaffon/shared/.deploy.lock.pid)
   ```
2. If the process is dead, remove the lock:
   ```bash
   rm /opt/mlaffon/shared/.deploy.lock.pid
   ```
3. Retry the deploy

---

## Scenario: CDN Serving Stale Content

**Symptoms**: Users see old version after deploy

**Resolution**:
1. Verify the deploy completed successfully:
   ```bash
   curl -s http://localhost:3001/version | jq .
   ```
2. Purge Cloudflare cache:
   ```bash
   # Selective purge (HTML only)
   CF_ZONE_ID=xxx CF_API_TOKEN=yyy ./deploy/verify-cdn.sh --purge

   # Nuclear option: purge everything
   CF_ZONE_ID=xxx CF_API_TOKEN=yyy ./deploy/verify-cdn.sh --purge-all
   ```
3. If no Cloudflare credentials available:
   - Go to Cloudflare dashboard → Caching → Purge Cache
   - Or wait for cache TTL (60s for HTML, 1yr for hashed assets)

---

## Scenario: Database Needs Rollback

**Symptoms**: New migration broke something that code rollback alone can't fix

**Impact**: Data integrity risk — proceed carefully

**Resolution**:
1. **Assess**: Is the migration additive (new column/table) or destructive (renamed/dropped)?
2. **If additive** (most common): Just rollback the code. Old code ignores new columns.
3. **If destructive**: Restore from pre-deploy backup
   ```bash
   # Find the pre-deploy backup
   ls -la /opt/mlaffon/shared/backups/mlaffon_predeploy_*.dump

   # Restore (will stop services, restore, restart)
   ./deploy/restore.sh /opt/mlaffon/shared/backups/mlaffon_predeploy_<sha>_<timestamp>.dump
   ```
4. **Verify after restore**:
   ```bash
   ./deploy/verify-release.sh
   ```

---

## Scenario: Complete Server Recovery

**Symptoms**: Server was rebuilt/reimaged, need to redeploy from scratch

**Resolution**:
1. Follow `docs/vps-deploy.md` for initial server setup
2. Set up the directory structure:
   ```bash
   sudo mkdir -p /opt/mlaffon/{releases,shared/{backups,logs},repo}
   sudo chown -R www-data:www-data /opt/mlaffon
   ```
3. Clone the repo:
   ```bash
   git clone git@github.com:<org>/mlaffon-tg-app.git /opt/mlaffon/repo
   ```
4. Create the shared env file:
   ```bash
   # Copy from backup or create fresh
   vim /opt/mlaffon/shared/env
   ```
5. Run the deploy pipeline:
   ```bash
   cd /opt/mlaffon/repo
   ./deploy/release.sh main
   ```

---

## Quick Reference

| Action | Command |
|--------|---------|
| Deploy | `./deploy/release.sh v1.2.3` |
| Rollback | `./deploy/rollback.sh` |
| Status | `./deploy/status.sh` |
| Verify | `./deploy/verify-release.sh` |
| Smoke test | `./deploy/smoke-test.sh` |
| Logs | `tail -f /opt/mlaffon/shared/logs/deploy-*.log` |
| API logs | `journalctl -u mlaffon-api -f` |
| Worker logs | `journalctl -u mlaffon-worker -f` |
