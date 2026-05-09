# Deploy Pipeline Reference

## Architecture

The mlaffon deploy pipeline uses **timestamped release directories** with an **atomic symlink switch** pattern. Each deploy creates an isolated directory under `/opt/mlaffon/releases/`, builds the application there, and swaps the `/opt/mlaffon/current` symlink only after a successful build and migration.

### Directory Layout

```
/opt/mlaffon/
├── releases/
│   ├── 20260420_143022_abc1234/    # timestamped release dirs
│   └── 20260420_151500_def5678/
├── current -> releases/20260420_151500_def5678   # atomic symlink
├── previous -> releases/20260420_143022_abc1234  # fast rollback
├── shared/
│   ├── env              # single source of truth for .env
│   ├── backups/         # pg_dump files
│   ├── logs/            # deploy logs
│   ├── deploy.env       # operator deploy config (optional)
│   ├── .deploy.lock     # flock-based deploy lock
│   └── deploy-history.jsonl  # append-only deploy log
└── repo/                # git clone for fetching
```

### Key Invariants

- `current` symlink is what systemd units and Caddy point to
- `previous` symlink always points to the last successful release
- Symlink switch is atomic via `ln -sfn`
- Environment file is shared (not per-release); linked into each release
- Deploy lock prevents concurrent deploys via `flock`

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy/release.sh` | Main pipeline orchestrator |
| `deploy/rollback.sh` | Standalone rollback to previous/specific release |
| `deploy/preflight.sh` | Pre-deploy environment checks |
| `deploy/status.sh` | Show current deployment status |
| `deploy/warmup.sh` | Post-deploy cache priming |
| `deploy/verify-cdn.sh` | CDN verification dispatcher (provider-aware) |
| `deploy/purge-cdn.sh` | CDN cache purge dispatcher (provider-aware) |
| `deploy/verify-release.sh` | Combined post-deploy gate |
| `deploy/backup.sh` | Database backup (supports `--pre-deploy`) |
| `deploy/smoke-test.sh` | Endpoint smoke tests (supports `--json`) |
| `deploy/common.sh` | Shared helpers (sourced, not executed) |

## Pipeline Stages (release.sh)

1. **Lock** — acquire `flock` on `.deploy.lock`
2. **Preflight** — disk, memory, tools, env, DB/Redis, node version
3. **Resolve** — determine target SHA from tag/sha/branch
4. **Create release dir** — clone at target SHA
5. **Link env** — symlink `.env → /opt/mlaffon/shared/env`
6. **Install** — `npm ci`
7. **Build** — `npm run build` (API + Web + Admin)
8. **Verify build** — check dist artifacts exist
9. **Backup** — `backup.sh --pre-deploy`
10. **Migrate** — `drizzle-kit push` with retry
11. **Permissions** — set file ownership/modes
12. **Switch** — atomic symlink `current → new release`
13. **Install systemd** — copy units, daemon-reload
14. **Restart API** — wait for `/health/ready` (30s timeout)
15. **Restart workers** — main + fraud workers
16. **Smoke tests** — full endpoint verification
17. **Version check** — confirm `/version` matches deployed SHA
18. **Warmup** — prime public endpoint caches
19. **CDN validation** — check cache headers, optional purge
20. **Caddy reload** — update config from release

After all stages: write metadata, clean old releases, print summary.

## Environment Variables

### Pipeline control (set before running release.sh)

| Variable | Default | Description |
|----------|---------|-------------|
| `MLAFFON_BASE` | `/opt/mlaffon` | Base directory |
| `API_PORT` | `3001` | API listen port |
| `DEPLOY_SKIP_BACKUP` | `0` | Skip pre-deploy backup |
| `DEPLOY_SKIP_MIGRATIONS` | `0` | Skip drizzle push |
| `DEPLOY_SKIP_CDN` | `0` | Skip CDN validation |
| `DEPLOY_SKIP_WARMUP` | `0` | Skip cache warmup |
| `DEPLOY_ALLOW_DESTRUCTIVE` | `0` | Allow destructive migrations |
| `DEPLOY_SKIP_FAQ_SYNC` | `0` | Skip db:sync-faq |
| `DEPLOY_DB_SEED` | `0` | Run db:seed |
| `DEPLOY_SKIP_SPEAKERPY` | `0` | Skip OBS SpeakerPy runtime setup |
| `SPEAKERPY_NLTK_DATA` | `/opt/mlaffon/shared/speakerpy-cache/nltk` | Override SpeakerPy tokenizer cache path |
| `RELEASE_RETENTION` | `5` | Number of releases to keep |

### CDN provider (verify-cdn.sh / purge-cdn.sh)

| Variable | Description |
|----------|-------------|
| `CDN_PROVIDER` | CDN provider: `yandex` / `cloudflare` / `none` (default: `none`) |
| `PUBLIC_WEB_URL` | Production URL (from shared env) |
| `PUBLIC_ADMIN_URL` | Admin URL (from shared env) |
| `YC_CDN_RESOURCE_ID` | Yandex CDN resource ID (when `CDN_PROVIDER=yandex`) |
| `YC_FOLDER_ID` | Yandex Cloud folder ID (when `CDN_PROVIDER=yandex`) |
| `YC_SA_KEY_FILE` | Path to SA key JSON (when `CDN_PROVIDER=yandex`) |
| `CF_ZONE_ID` | Cloudflare zone ID (when `CDN_PROVIDER=cloudflare`) |
| `CF_API_TOKEN` | Cloudflare API token (when `CDN_PROVIDER=cloudflare`) |

## Failure Handling

| Stage | Failure Behavior |
|-------|-----------------|
| Preflight | Abort, exit 1, no changes |
| npm ci / build | Delete incomplete release dir, exit 1 |
| Backup | Abort, exit 1, old release untouched |
| Migration | Abort, exit 1, old release still active |
| Post-switch health/smoke | **Auto-rollback**: restore previous symlink, restart, verify |
| Warmup | Warning only, non-blocking |
| CDN validation | Warning only, non-blocking |
| Rollback health fail | CRITICAL: operator alert, manual intervention |

## systemd Integration

All three service units point to the `current` symlink:

```ini
WorkingDirectory=/opt/mlaffon/current/apps/api
EnvironmentFile=/opt/mlaffon/shared/env
```

Services: `mlaffon-api`, `mlaffon-worker`, `mlaffon-worker-fraud`

## CI/CD

- **ci.yml**: On tag push (`v*`), creates a release tarball and GitHub Release
- **deploy.yml**: Triggered by release publish or manual dispatch; SSHs to server and runs `release.sh`
