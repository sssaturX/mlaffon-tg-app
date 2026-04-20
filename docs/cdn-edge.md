# CDN & Edge Strategy

## Architecture

```
Users → CDN Edge → Caddy (origin) → Fastify API
                                   → Static files (web/admin dist)
                                   → S3 (media via MEDIA_PUBLIC_BASE_URL)
```

The CDN provider is controlled by the `CDN_PROVIDER` environment variable:

| Value | Provider | Notes |
|---|---|---|
| `yandex` | Yandex Cloud CDN | Primary production provider |
| `cloudflare` | Cloudflare | Backward compatibility |
| `none` | No CDN | Direct origin access, CDN checks skipped |

## Cache Strategy (provider-neutral)

Origin (Caddy) sets `Cache-Control` headers. All CDN providers are configured to
respect origin cache headers ("same as origin" or "respect existing headers").

| Path Pattern | Cache | TTL | Notes |
|---|---|---|---|
| `/assets/*` | Edge + Browser | 1 year | Vite-hashed filenames; immutable |
| `/sw.js` | No cache | 0 | Service worker must always be fresh |
| `/api/v1/home/*` | Edge respect headers | 5min | Public, non-personalized |
| `/api/v1/*` (auth) | No edge cache | - | Personalized; `private` Cache-Control |
| `/api/admin/*` | No edge cache | - | Admin; `private, no-store` |
| `*.html` | Edge + Browser | 60s | SPA shell; `stale-while-revalidate=300` |

## Cache Purge Strategy

- On deploy: purge `/index.html` and `/` (assets are content-hashed, no purge needed)
- Emergency full purge: `./deploy/purge-cdn.sh --all`
- Targeted purge: `./deploy/purge-cdn.sh /index.html /`
- Automatic: CDN respects `Cache-Control` headers from origin

## Compression / Vary Safety

This is critical for correct CDN behavior. The strategy:

1. **Edge compression enabled** on the CDN (Yandex: `--gzip-on`; Cloudflare: Brotli/gzip auto)
2. **Origin (Caddy) compression ON** — benefits direct/non-CDN access
3. **Caddy always sends `Vary: Accept-Encoding`** — defense-in-depth
4. **`verify-cdn.sh` validates** that compressed content is NOT served to non-gzip clients

Without `Vary: Accept-Encoding`, a CDN may cache a gzip response and serve it to
all clients including those that don't support gzip. Caddy's `encode` directive
adds this header automatically; we also set it explicitly in the Caddyfile.

## Yandex Cloud CDN

See [docs/yandex-cdn.md](yandex-cdn.md) for the complete operator guide.

### Key Settings
- **Caching**: "Same as origin" (respects `Cache-Control`)
- **Compression**: Edge compression enabled (`--gzip-on`)
- **Origin**: Caddy HTTPS on the server
- **Purge**: Via `yc cdn cache purge` CLI

### Origin Protection (Yandex CDN)
Yandex CDN does NOT publish stable edge IP ranges. Origin protection options:

1. **Origin secret header** (recommended hardening): Configure CDN resource to send
   `X-Origin-Auth: <secret>` on requests to origin. Caddy validates the header.
2. **Application-level protection** (baseline): Origin is publicly reachable but
   protected by TLS, rate limiting, JWT auth on private endpoints. Static assets
   are public by design. API binds to `127.0.0.1:3001` (only Caddy can reach it).

### Trusted Proxies
Without known CDN IP ranges, Caddy's `trusted_proxies` is omitted. `{remote_host}`
will be the CDN edge IP. Application-level client IP extraction uses
`X-Forwarded-For` / `X-Real-IP` headers forwarded by the CDN.

## Cloudflare (legacy/backward compat)

### DNS
- `mlaffon.fun` → VPS IP (proxied, orange cloud)
- `admin.mlaffon.fun` → VPS IP (proxied, orange cloud)

### Cloudflare Settings
- **SSL/TLS**: Full (strict)
- **Always Use HTTPS**: On
- **HTTP/3**: On
- **Brotli**: On
- **Browser Cache TTL**: Respect Existing Headers
- **Security Level**: Medium
- **WAF**: OWASP rules enabled
- **Rate Limiting**: 1000 req/min per IP on `/api/*`

### Origin Protection (Cloudflare)
Firewall restricts `:80/:443` to Cloudflare IP ranges only:
```bash
ufw default deny incoming
ufw allow from 173.245.48.0/20 to any port 80,443 proto tcp
ufw allow from 103.21.244.0/22 to any port 80,443 proto tcp
# ... add all Cloudflare ranges from https://www.cloudflare.com/ips-v4
ufw allow ssh
ufw enable
```

When switching to Cloudflare, uncomment the `trusted_proxies` block in the Caddyfile.

## CDN_PROVIDER=none

When CDN is disabled:
- All CDN-specific checks in `verify-cdn.sh` are skipped
- Universal origin header checks (Cache-Control, HSTS, security headers) still run
- Purge is a no-op
- Origin is accessed directly

## Media Delivery

- Images uploaded to S3 via `@aws-sdk/client-s3`
- Public URLs served via `MEDIA_PUBLIC_BASE_URL` (should point to CDN)
- Sharp pipeline generates AVIF/WebP/JPEG variants + LQIP
- `ResponsivePicture` component serves `<picture>` with srcset
- CDN should cache media with `Cache-Control: public, max-age=31536000`

## Operator Commands

```bash
# Verify CDN headers and edge behavior
./deploy/verify-cdn.sh

# Verify + purge index.html
./deploy/verify-cdn.sh --purge

# Targeted purge
./deploy/purge-cdn.sh /index.html /

# Full cache purge (use sparingly)
./deploy/purge-cdn.sh --all

# Dry run (preview purge without executing)
./deploy/purge-cdn.sh --dry-run /index.html

# Check deployment status including CDN provider
./deploy/status.sh
```
