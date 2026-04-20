# Cache Strategy

## Cache Layers

```
Browser Cache → CDN Edge (Cloudflare) → Caddy → Fastify App Cache → Redis → PostgreSQL
```

## Per-Domain Cache Policy

### Public Endpoints (cacheable on CDN)

| Endpoint | Cache-Control | Redis Cache | TTL | Notes |
|---|---|---|---|---|
| `/api/v1/home/public` | `public, max-age=300, swr=3600` | - | 5min | Non-personalized |
| `/api/v1/home/content` | `public, max-age=300, swr=3600` | - | 5min | Non-personalized |
| `/api/v1/home/giveaways` | `public, max-age=30, swr=120` | - | 30s | Giveaway list |
| `/api/v1/leaderboard` | `public, max-age=60, swr=300` | Yes | 60s | Redis-cached results |

### Private/Personalized Endpoints (no CDN cache)

| Endpoint | Cache-Control | Redis Cache | TTL | Notes |
|---|---|---|---|---|
| `/api/v1/me` | `private, no-cache` | - | - | Per-user |
| `/api/v1/referrals` | `private, max-age=60, swr=300` | - | 60s | Browser only |
| `/api/v1/tasks` | `private, max-age=15` | Yes (per-user) | 30s | Personalized |
| `/api/v1/shop` | `private, max-age=10, swr=60` | Yes (per-platform) | 25s | Platform-specific |
| `/api/v1/fortune/*` | `private, no-cache` | - | - | Balance-sensitive |
| `/api/v1/predictions/*` | `private, no-cache` | - | - | Real-time |

### Admin Endpoints (never cached)

| Endpoint | Cache-Control | Notes |
|---|---|---|
| `/api/admin/*` | `private, no-store` | Sensitive operations |

### Static Assets

| Pattern | Cache-Control | Notes |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | Vite content-hashed |
| `/sw.js` | `public, max-age=0, must-revalidate` | Service worker |
| `*.html` | `public, max-age=60, swr=300` | SPA shell |

## Redis Cache Keys

| Key Pattern | TTL | Invalidation |
|---|---|---|
| `mlaffon:tasks:catalog:v1` | 300s | On task create/update/delete |
| `mlaffon:tasks:userdto:v1:<userId>` | 30s | On task action, SCAN-based flush |
| `mlaffon:shop:bundle:v1:<platform>` | 25s | On shop item/settings change |
| `mlaffon:leaderboard:v1:<sort>:<platform>` | 60s | Natural TTL expiry |

## Invalidation Patterns
- **Task catalog**: explicit DEL on admin mutation
- **User tasks**: per-user DEL + SCAN-based flush all
- **Shop bundle**: explicit DEL per platform
- **Leaderboard**: TTL-only (no active invalidation)

## Cache Stampede Protection
- `singleFlight` pattern on task catalog and shop bundle loads
- Only one in-flight DB query per cache key; concurrent requests wait

## Anti-Patterns Removed
- ~~Redis `KEYS` command~~ → replaced with `SCAN` (non-blocking)
- ~~Write-on-read (giveaway finalization)~~ → moved to cron job
- ~~`origin: true` in CORS~~ → explicit allowlist
