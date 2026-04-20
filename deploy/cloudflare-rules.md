# Cloudflare Configuration Guide

## DNS Setup

```
Type  Name             Content          Proxy Status
A     mlaffon.fun      <VPS_IP>         Proxied (orange)
A     admin.mlaffon.fun <VPS_IP>        Proxied (orange)
CNAME img.mlaffon.fun   <s3-endpoint>   Proxied (orange)  [if using separate media CDN]
```

## SSL/TLS Settings
- Mode: **Full (Strict)**
- Always Use HTTPS: **On**
- HTTP Strict Transport Security: **Enabled** (match Caddy HSTS)
- Minimum TLS Version: **1.2**
- TLS 1.3: **On**

## Caching

### Browser Cache TTL
- Setting: **Respect Existing Headers**

### Cache Rules (in order of priority)

#### Rule 1: Never cache admin API
- Expression: `(http.request.uri.path starts_with "/api/admin")`
- Action: **Bypass Cache**

#### Rule 2: Never cache authenticated API
- Expression: `(http.request.uri.path starts_with "/api/v1/" and http.request.headers["authorization"] ne "")`
- Action: **Bypass Cache**

#### Rule 3: Cache public API
- Expression: `(http.request.uri.path starts_with "/api/v1/home")`
- Action: **Cache Everything**, Edge TTL: **Respect Origin**

#### Rule 4: Immutable static assets
- Expression: `(http.request.uri.path starts_with "/assets/")`
- Action: **Cache Everything**, Edge TTL: **1 year**, Browser TTL: **1 year**

#### Rule 5: Service worker
- Expression: `(http.request.uri.path eq "/sw.js")`
- Action: **Bypass Cache**

#### Rule 6: HTML pages
- Expression: `(http.request.uri.path eq "/" or ends_with(http.request.uri.path, ".html"))`
- Action: **Cache Everything**, Edge TTL: **1 minute**

## WAF Rules

### OWASP Core Ruleset
- Enable: **Paranoia Level 1**
- Anomaly score threshold: **25** (default)

### Custom Rules

#### Rate limit admin login
- Expression: `(http.request.uri.path eq "/api/admin/login" and http.request.method eq "POST")`
- Action: **Rate Limit** — 10 requests per 5 minutes per IP
- Response: 429

#### Rate limit API auth
- Expression: `(http.request.uri.path starts_with "/api/v1/auth")`
- Action: **Rate Limit** — 30 requests per minute per IP

#### Block direct IP access
- Expression: `(http.host ne "mlaffon.fun" and http.host ne "admin.mlaffon.fun")`
- Action: **Block**

## Speed Settings
- Auto Minify: **JavaScript, CSS**
- Brotli: **On**
- HTTP/2: **On**
- HTTP/3: **On**
- Rocket Loader: **Off** (conflicts with SPA)
- Mirage: **Off**

## Scrape Shield
- Email Address Obfuscation: **Off** (breaks API JSON)
- Server-side Excludes: **Off**

## Network
- HTTP/2 to Origin: **On**
- WebSockets: **On** (required for `/api/v1/ws`)
- gRPC: **Off**
- Onion Routing: **On**
- IP Geolocation: **On**

## Firewall (optional hardening)
On the VPS, restrict ports 80/443 to Cloudflare IPs only:

```bash
#!/bin/bash
# Cloudflare-only firewall
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from $ip to any port 80,443 proto tcp
done
ufw default deny incoming
ufw allow ssh
ufw enable
```

## Purge Strategy
- On deploy: purge `/index.html` only (assets are content-hashed)
- Command:
  ```bash
  curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -d '{"files":["https://mlaffon.fun/","https://mlaffon.fun/index.html","https://admin.mlaffon.fun/","https://admin.mlaffon.fun/index.html"]}'
  ```

## Validation Checklist
After enabling Cloudflare proxy:
- [ ] `curl -I https://mlaffon.fun/assets/index-HASH.js` → `cf-cache-status: HIT`
- [ ] `curl -I https://mlaffon.fun/api/v1/home/public` → `cf-cache-status: HIT` (after first request)
- [ ] `curl -I https://mlaffon.fun/api/v1/me` → `cf-cache-status: BYPASS` or `DYNAMIC`
- [ ] `curl -I https://mlaffon.fun/api/admin/stats` → `cf-cache-status: BYPASS`
- [ ] WebSocket at `wss://mlaffon.fun/api/v1/ws?ticket=...` connects successfully
- [ ] Admin login at `https://admin.mlaffon.fun` works
- [ ] Direct IP access is blocked
