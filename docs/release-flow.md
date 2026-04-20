# Release Flow — Operator Guide

## Prerequisites

Before your first deploy with the new pipeline:

1. **Server directory structure** must exist:
   ```bash
   sudo mkdir -p /opt/mlaffon/{releases,shared/{backups,logs}}
   sudo chown -R www-data:www-data /opt/mlaffon
   ```

2. **Git repo** cloned on the server:
   ```bash
   git clone git@github.com:<org>/mlaffon-tg-app.git /opt/mlaffon/repo
   ```

3. **Shared env** file in place:
   ```bash
   cp /opt/mlaffon/mlaffon-tg-app/apps/api/.env /opt/mlaffon/shared/env
   ```

4. **systemd units** will be installed automatically by the pipeline.

## Cutting a Release

### 1. Ensure CI is green on `main`

Check the latest CI run on GitHub Actions.

### 2. Create a version tag

```bash
git tag v1.2.3
git push origin v1.2.3
```

CI will automatically:
- Run all quality checks
- Build all apps
- Create a release tarball
- Publish a GitHub Release

### 3. Deploy

**Option A — Automatic (via GitHub Actions):**

The `deploy.yml` workflow triggers on release publish. It SSHs to the server and runs `release.sh`.

**Option B — Manual (SSH to server):**

```bash
ssh deploy@your-server
cd /opt/mlaffon/repo

# Deploy a tag
./deploy/release.sh v1.2.3

# Deploy latest main
./deploy/release.sh

# Deploy specific SHA
./deploy/release.sh abc1234

# Dry run (preflight only)
./deploy/release.sh --dry-run
```

## During Deploy

The pipeline will print a step-by-step progress log:

```
Step 1: Acquire deploy lock
Step 2: Preflight checks
  ✓ Disk space: 15234MB available
  ✓ Node.js: v20.12.0 (>= 20)
  ...
Step 7: Build (API + Web + Admin)
  ✓ Build complete
Step 12: Atomic symlink switch
  ✓ Switched: current → 20260420_151500_def5678
  ...
```

A full deploy log is saved to `/opt/mlaffon/shared/logs/deploy-<timestamp>.log`.

## Rollback

### Quick rollback (to previous release)

```bash
./deploy/rollback.sh
```

This will:
1. Switch the `current` symlink to `previous`
2. Save the failed release as `previous` (enabling "rollback the rollback")
3. Reinstall systemd units from the target release
4. Restart all services
5. Run health checks and smoke tests

### Rollback to a specific release

```bash
# List available releases
./deploy/status.sh

# Rollback to a specific one
./deploy/rollback.sh 20260418_120000_abc1234
```

### Database rollback

Database rollback is **not automatic** because it's too risky. If a migration needs to be reverted:

1. Check what the migration added:
   ```bash
   cat /opt/mlaffon/current/apps/api/drizzle/*.sql
   ```

2. Manually revert with SQL (see `docs/runbooks-deploy.md`)

3. Purge Redis if needed:
   ```bash
   redis-cli FLUSHDB
   ```

## Checking Status

```bash
./deploy/status.sh
```

Shows:
- Current and previous release info
- Service statuses with timestamps
- API health and version
- Disk usage
- Available releases
- Recent deploy history
- Deploy lock status

## Post-deploy Verification

Run the full verification gate:

```bash
./deploy/verify-release.sh
```

Or individual checks:

```bash
./deploy/smoke-test.sh http://localhost:3001          # smoke tests
./deploy/smoke-test.sh http://localhost:3001 --json    # JSON output
./deploy/verify-cdn.sh                                 # CDN headers (provider-aware)
./deploy/verify-cdn.sh --purge                         # CDN + purge HTML
./deploy/purge-cdn.sh /index.html /                    # targeted CDN purge
./deploy/purge-cdn.sh --all                            # full CDN purge
./deploy/purge-cdn.sh --dry-run /index.html            # preview purge
./deploy/warmup.sh                                     # cache warmup
```

## Environment Changes

The shared env file lives at `/opt/mlaffon/shared/env`. To update it:

```bash
sudo vim /opt/mlaffon/shared/env
sudo systemctl restart mlaffon-api mlaffon-worker mlaffon-worker-fraud
```

No redeploy needed for env-only changes.

## Emergency Procedures

### API is down after deploy

```bash
# Quick rollback
./deploy/rollback.sh

# Or manual restart
sudo systemctl restart mlaffon-api
journalctl -u mlaffon-api -n 50
```

### Deploy is stuck (lock held)

```bash
# Check who holds the lock
cat /opt/mlaffon/shared/.deploy.lock.pid

# Kill if stale
kill <pid>
rm /opt/mlaffon/shared/.deploy.lock.pid

# Retry
./deploy/release.sh v1.2.3
```

### Need to skip a stage

```bash
DEPLOY_SKIP_BACKUP=1 DEPLOY_SKIP_MIGRATIONS=1 ./deploy/release.sh v1.2.3
```
