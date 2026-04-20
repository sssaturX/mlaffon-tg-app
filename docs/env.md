# Environment Variables Reference

## Required (all environments)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | User JWT signing secret (min 16 chars) |
| `REDIS_URL` | Redis connection URL |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token |
| `TOKENS_ENCRYPTION_KEY` | AES-256-GCM key for OAuth token encryption |

## Required (production only)

| Variable | Description |
|---|---|
| `CORS_ORIGINS` or `PUBLIC_WEB_URL` | At least one must be set |
| `NODE_ENV=production` | Enables strict security checks |

## Optional

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3001 | API server port |
| `HOST` | 0.0.0.0 | API server bind address |
| `PG_POOL_MAX` | 20 | Max PostgreSQL pool size |
| `LOG_LEVEL` | info | Pino log level |
| `API_SLOW_REQUEST_MS` | 2000 | Slow request threshold |
| `ALLOW_DEV_AUTH` | 0 | Dev auth routes (blocked in prod) |
| `ADMIN_EMAIL` | - | Admin login email |
| `ADMIN_PASSWORD` | - | Admin login password |
| `ADMIN_PASSPHRASE` | - | Admin extra auth factor |
| `ADMIN_JWT_SECRET` | JWT_SECRET | Separate admin JWT secret |

## Validation

Env validation runs at startup via `validateEnv()`:
- Missing required vars → process exits with error
- `ALLOW_DEV_AUTH=1` in production → process exits
- Default `JWT_SECRET` in production → process exits

## CDN / Deploy Pipeline

| Variable | Default | Description |
|---|---|---|
| `CDN_PROVIDER` | `none` | CDN provider: `yandex` / `cloudflare` / `none` |
| `YC_CDN_RESOURCE_ID` | - | Yandex CDN resource ID (required when `CDN_PROVIDER=yandex`) |
| `YC_FOLDER_ID` | - | Yandex Cloud folder ID |
| `YC_SA_KEY_FILE` | - | Path to service account key JSON |
| `YC_IAM_TOKEN` | - | Short-lived IAM token (alternative to SA key) |
| `CF_ZONE_ID` | - | Cloudflare zone ID (required when `CDN_PROVIDER=cloudflare`) |
| `CF_API_TOKEN` | - | Cloudflare API token |

See [docs/cdn-edge.md](cdn-edge.md) and [docs/yandex-cdn.md](yandex-cdn.md) for CDN configuration details.

## Generating Secrets

```bash
# JWT_SECRET / ADMIN_JWT_SECRET
openssl rand -hex 32

# TOKENS_ENCRYPTION_KEY
openssl rand -base64 32

# VAPID keys
cd apps/api && npx web-push generate-vapid-keys
```
