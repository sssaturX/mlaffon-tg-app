# Yandex Cloud CDN — Operator Guide

## Overview

This document covers setup, configuration, and day-to-day operations for the
Yandex Cloud CDN integration in the mlaffon-tg-app project.

## Prerequisites

1. **Yandex Cloud account** with a folder
2. **`yc` CLI** installed on the server: https://cloud.yandex.ru/docs/cli/operations/install-cli
3. **Service account** with `cdn.editor` + `iam.serviceAccounts.tokenCreator` roles
4. **SA key file** on the server (e.g., `/opt/mlaffon/shared/yc-sa-key.json`)

### Install yc CLI

```bash
curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
# or via snap:
# sudo snap install yandex-cloud --classic
```

### Create service account and key

```bash
yc iam service-account create --name mlaffon-cdn-sa --folder-id <folder-id>
yc resource-manager folder add-access-binding <folder-id> \
  --role cdn.editor \
  --subject serviceAccount:<sa-id>
yc iam key create --service-account-id <sa-id> --output /opt/mlaffon/shared/yc-sa-key.json
```

## CDN Resource Setup

### Create CDN resource

```bash
yc cdn resource create \
  --cname mlaffon.fun \
  --origin-custom-source mlaffon.fun \
  --origin-protocol https \
  --folder-id <folder-id> \
  --active
```

### Enable compression (critical)

```bash
yc cdn resource update <resource-id> --gzip-on
```

This enables edge compression. The CDN requests **uncompressed** content from
origin and compresses at the edge for clients that accept it. This prevents the
known issue where a CDN caches a gzip response and serves it to all clients
without proper `Vary: Accept-Encoding` handling.

### Configure caching

Recommended: "respect origin headers" (default). The CDN uses `Cache-Control`
headers set by Caddy (origin) to determine edge cache TTLs.

```bash
# Verify current settings
yc cdn resource get <resource-id>
```

### Enable HTTPS

The CDN resource's CNAME (e.g., `mlaffon.fun`) needs a certificate. Options:

1. **Let's Encrypt via Yandex Cloud Certificate Manager** (recommended):
   ```bash
   yc certificate-manager certificate request \
     --name mlaffon-cert \
     --domains mlaffon.fun,admin.mlaffon.fun
   ```

2. **Upload your own certificate** via Certificate Manager

Then attach it to the CDN resource:
```bash
yc cdn resource update <resource-id> \
  --cert-manager-ssl-cert-id <cert-id>
```

## DNS Configuration

Point domain CNAMEs to the Yandex CDN endpoint:

```
mlaffon.fun         CNAME  <resource-id>.gcdn.co
admin.mlaffon.fun   CNAME  <resource-id>.gcdn.co
```

The exact CNAME target is shown in `yc cdn resource get <resource-id>` under
`cname` field.

## Environment Variables

Set these in `/opt/mlaffon/shared/env`:

```bash
CDN_PROVIDER=yandex
YC_CDN_RESOURCE_ID=bc8xxxxxxxxxx
YC_FOLDER_ID=b1gxxxxxxxxxx
# Auth option A (for CI):
# YC_IAM_TOKEN=t1.xxxxxxxx
# Auth option B (for server, recommended):
YC_SA_KEY_FILE=/opt/mlaffon/shared/yc-sa-key.json
```

## Day-to-Day Operations

### Verify CDN behavior

```bash
./deploy/verify-cdn.sh
```

Checks:
- Cache-Control headers on static assets, HTML, public API
- Security headers (HSTS, nosniff)
- Compression / `Vary: Accept-Encoding` safety
- Edge cache behavior (X-Cache if available, response times)
- Private API bypass (not cached on edge)

### Purge cache (targeted)

```bash
./deploy/purge-cdn.sh /index.html /
```

Purges specific paths. Content-hashed assets (`/assets/*`) normally don't need
purging since new deploys produce new filenames.

### Purge cache (full)

```bash
./deploy/purge-cdn.sh --all
```

Use sparingly. Full purge may take up to 15 minutes to propagate.

### Dry run

```bash
./deploy/purge-cdn.sh --dry-run /index.html
```

Shows what would be purged without executing.

### Check status

```bash
./deploy/status.sh
```

Shows current CDN provider and deployment status.

## Origin Protection

Yandex CDN does not publish stable edge IP ranges, so firewall-based IP allowlisting
(as used with Cloudflare) is not practical.

### Baseline protection (current)
- Origin is publicly reachable via HTTPS
- API binds to `127.0.0.1:3001` — only Caddy can reach it
- Private endpoints require JWT authentication
- Rate limiting is active on the API layer
- Static assets are public by design

### Recommended hardening: origin secret header

Configure the CDN resource to add a custom header on all requests to origin:

```bash
yc cdn resource update <resource-id> \
  --origin-header "X-Origin-Auth: <random-secret>"
```

Then add a Caddy matcher to reject requests without this header:

```caddy
@no_cdn_auth {
    not header X-Origin-Auth "<random-secret>"
}
respond @no_cdn_auth 403
```

This ensures only CDN-proxied requests reach the origin.

## Cache Behavior Details

### Query parameters
Yandex CDN by default considers query parameters as part of the cache key.
For this project, query parameters are not used for static assets, so the
default behavior is correct.

### Cookies
Yandex CDN forwards cookies to origin but does not use them as cache keys.
`Cache-Control: private` on authenticated endpoints prevents edge caching.

### Vary header
Origin sends `Vary: Accept-Encoding` on all compressible responses. The CDN
maintains separate cache entries for each `Accept-Encoding` variant.

## Troubleshooting

### CDN returns stale content after deploy
```bash
./deploy/purge-cdn.sh /index.html /
# Wait up to 15 minutes for propagation
./deploy/verify-cdn.sh
```

### Compression not working
1. Verify edge compression is enabled: `yc cdn resource get <resource-id>`
2. Check that origin sends `Vary: Accept-Encoding`: `curl -sI https://mlaffon.fun/`
3. Re-enable: `yc cdn resource update <resource-id> --gzip-on`

### Purge fails with auth error
1. Check `yc` CLI auth: `yc iam create-token`
2. Verify SA key file exists: `ls -la /opt/mlaffon/shared/yc-sa-key.json`
3. Check SA role: needs `cdn.editor`

### CDN settings not taking effect
Yandex CDN configuration changes may take up to 15 minutes to propagate.
`verify-cdn.sh` has built-in retry logic for edge checks.

### Direct origin bypass
If you need to bypass CDN for debugging:
```bash
# Test origin directly
curl -sI --resolve mlaffon.fun:443:<server-ip> https://mlaffon.fun/
```

Or temporarily set `CDN_PROVIDER=none` and update DNS to point directly to the
server IP.

## IaC Roadmap

Currently, CDN resource setup is manual + documented. Future options:

1. **Terraform** with `yandex_cdn_resource` provider
2. **yc CLI scripts** in `deploy/infra/` for reproducible setup
3. **Pulumi** for TypeScript-native IaC

For now, the manual setup documented above is the production path. All
day-to-day operations (purge, verify) are fully automated via deploy scripts.
