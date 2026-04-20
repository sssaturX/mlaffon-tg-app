# Server Bootstrap Guide

## Overview

This guide takes a fresh Ubuntu 22.04/24.04 VPS from zero to a fully
operational production system running the mlaffon-tg-app deploy pipeline.

### What gets installed

| Component | Version | Purpose |
|---|---|---|
| Node.js | 20.x LTS | Application runtime |
| PostgreSQL | 16 | Primary database |
| Redis | 7.x | Cache, queues (BullMQ), sessions |
| Caddy | latest | Reverse proxy, TLS, static files |
| UFW | system | Firewall |

### Minimum VPS requirements

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 10 GB | 20 GB SSD |
| OS | Ubuntu 22.04 | Ubuntu 24.04 |

## Quick Start (TL;DR)

```bash
# 1. SSH into your fresh VPS
ssh root@your-server

# 2. Clone the repo (or upload bootstrap.sh)
git clone git@github.com:<org>/mlaffon-tg-app.git /tmp/mlaffon-bootstrap
cd /tmp/mlaffon-bootstrap

# 3. Run bootstrap
sudo ./deploy/bootstrap.sh --repo-url git@github.com:<org>/mlaffon-tg-app.git

# 4. Generate environment
sudo -u www-data /opt/mlaffon/repo/deploy/generate-env.sh

# 5. First deploy
sudo -u www-data /opt/mlaffon/repo/deploy/release.sh main

# 6. Validate
/opt/mlaffon/repo/deploy/verify-server.sh
```

Total time: ~10-20 minutes.

## Step-by-Step Guide

### 1. Bootstrap the server

The `bootstrap.sh` script handles all system-level setup:

```bash
sudo ./deploy/bootstrap.sh
```

What it does (14 steps):
1. System update & base package installation
2. App user setup (`www-data` by default)
3. Node.js 20.x LTS installation
4. PostgreSQL 16 installation + database/user creation
5. Redis installation + hardening
6. Caddy installation from official repo
7. Directory structure creation (`/opt/mlaffon/...`)
8. Git repository clone
9. systemd unit installation
10. UFW firewall configuration
11. SSH hardening
12. Backup cron setup
13. Logrotate configuration
14. Script permissions

#### Options

```bash
# Custom app user
sudo ./deploy/bootstrap.sh --app-user deploy

# Provide repo URL
sudo ./deploy/bootstrap.sh --repo-url git@github.com:org/repo.git

# Skip specific components (if already set up)
sudo ./deploy/bootstrap.sh --skip-db --skip-redis
sudo ./deploy/bootstrap.sh --skip-caddy --skip-firewall
```

#### Important output

Bootstrap prints a `DATABASE_URL` with the auto-generated password. **Save it.**
You'll need it for the env file.

### 2. DNS setup

Before deploying, point your domains to the VPS IP:

```
mlaffon.fun         A    <server-ip>
admin.mlaffon.fun   A    <server-ip>
```

If using Yandex CDN, point to the CDN CNAME instead (see [docs/yandex-cdn.md](yandex-cdn.md)).

### 3. Generate the environment file

```bash
sudo -u www-data /opt/mlaffon/repo/deploy/generate-env.sh
```

This interactive script:
- Prompts for required values (DATABASE_URL, Telegram token, etc.)
- Auto-generates secrets (JWT_SECRET, TOKENS_ENCRYPTION_KEY)
- Creates `/opt/mlaffon/shared/env` with secure permissions (600)
- Validates that all required keys are present

For non-interactive use (CI or scripted setup):

```bash
# Pre-set values via environment variables, then:
DATABASE_URL="postgres://..." \
TELEGRAM_BOT_TOKEN="..." \
/opt/mlaffon/repo/deploy/generate-env.sh --non-interactive
```

### 4. First deploy

```bash
sudo -u www-data /opt/mlaffon/repo/deploy/release.sh main
```

Or deploy a specific tag:

```bash
sudo -u www-data /opt/mlaffon/repo/deploy/release.sh v1.0.0
```

The release pipeline will:
1. Run preflight checks
2. Clone at the target ref
3. `npm ci` && `npm run build`
4. Run database migrations
5. Switch the `current` symlink
6. Install systemd units and restart services
7. Run health checks, smoke tests, CDN verification
8. Start Caddy (if not already running)

### 5. Validate

```bash
/opt/mlaffon/repo/deploy/verify-server.sh
```

This checks everything: system, tools, services, directories, env, ports, CDN,
backup cron, and current deployment health.

### 6. CDN setup (Yandex Cloud CDN)

See [docs/yandex-cdn.md](yandex-cdn.md) for the full CDN operator guide.

Quick steps:
1. Install yc CLI: `curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash`
2. Create CDN resource pointing to your origin
3. Enable compression (`--gzip-on`)
4. Update DNS to CDN CNAME
5. Set `CDN_PROVIDER=yandex` and `YC_CDN_RESOURCE_ID` in the env file

## Environment File Reference

The env file at `/opt/mlaffon/shared/env` is the single source of truth.
All systemd services and deploy scripts read from it.

### Required keys

| Key | Description |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | User JWT signing key (auto-generated) |
| `TOKENS_ENCRYPTION_KEY` | OAuth token encryption key (auto-generated) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username |
| `PUBLIC_WEB_URL` | e.g., `https://mlaffon.fun` |
| `PUBLIC_ADMIN_URL` | e.g., `https://admin.mlaffon.fun` |
| `CORS_ORIGINS` | Comma-separated allowed origins |

See [docs/env.md](env.md) for the complete reference.

## Directory Layout

```
/opt/mlaffon/
├── releases/                    # timestamped release dirs
│   ├── 20260420_143022_abc1234/
│   └── ...
├── current -> releases/...      # active release (atomic symlink)
├── previous -> releases/...     # previous release (fast rollback)
├── repo/                        # bare git clone for fetching
└── shared/
    ├── env                      # environment variables (600 perms)
    ├── backups/                 # pg_dump files
    ├── logs/                    # deploy + backup logs
    ├── .deploy.lock             # flock-based concurrent deploy lock
    └── deploy-history.jsonl     # append-only deploy log
```

## Firewall Rules

Bootstrap configures UFW:

| Port | Protocol | Purpose |
|---|---|---|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (Caddy → HTTPS redirect) |
| 443 | TCP | HTTPS (Caddy) |

All other incoming traffic is denied. API binds to `127.0.0.1:3001` (not
exposed externally; only Caddy can reach it).

## systemd Services

| Service | Description | Depends on |
|---|---|---|
| `mlaffon-api` | Fastify API server | postgresql, redis |
| `mlaffon-worker` | BullMQ background worker | postgresql, redis |
| `mlaffon-worker-fraud` | Fraud review worker | postgresql, redis |
| `caddy` | Reverse proxy + TLS | network |

Commands:

```bash
sudo systemctl status mlaffon-api
sudo systemctl restart mlaffon-api
sudo journalctl -u mlaffon-api -f     # live logs
sudo journalctl -u mlaffon-api -n 100 # last 100 lines
```

## Backup

Daily PostgreSQL backups run at 02:00 via cron:

```bash
# Manual backup
/opt/mlaffon/current/deploy/backup.sh

# List backups
ls -la /opt/mlaffon/shared/backups/

# Restore
/opt/mlaffon/current/deploy/restore.sh /opt/mlaffon/shared/backups/mlaffon_*.dump
```

Retention: 14 days (configurable via `RETENTION_DAYS`).

## Troubleshooting

### Bootstrap fails at PostgreSQL

```bash
# Check apt sources
cat /etc/apt/sources.list.d/pgdg.list

# Try installing manually
sudo apt-get update
sudo apt-get install postgresql-16

# Check status
sudo systemctl status postgresql
sudo -u postgres psql -c "SELECT version();"
```

### Bootstrap fails at Caddy

```bash
# Check Caddy repo
cat /etc/apt/sources.list.d/caddy-stable.list

# Install manually
sudo apt-get install caddy

# Validate config
sudo caddy validate --config /etc/caddy/Caddyfile
```

### Can't connect to database

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check pg_hba.conf allows local connections
sudo cat /etc/postgresql/16/main/pg_hba.conf | grep mlaffon

# Test connection
psql -U mlaffon -h 127.0.0.1 -d mlaffon
```

### Redis not responding

```bash
sudo systemctl status redis-server
redis-cli ping

# Check config
grep "bind" /etc/redis/redis.conf
grep "protected-mode" /etc/redis/redis.conf
```

### First deploy fails

```bash
# Run preflight independently
/opt/mlaffon/repo/deploy/preflight.sh

# Check env file
cat /opt/mlaffon/shared/env | grep -v 'SECRET\|TOKEN\|KEY\|PASSWORD'

# Check permissions
ls -la /opt/mlaffon/
ls -la /opt/mlaffon/shared/env
```

### Caddy won't start

```bash
# Caddy needs the app dirs to exist (created by first deploy)
sudo systemctl status caddy
sudo journalctl -u caddy -n 50

# Validate config
sudo caddy validate --config /etc/caddy/Caddyfile

# Common issue: domain doesn't resolve to this IP yet
# Solution: update DNS first, then start Caddy
```

### Ports blocked

```bash
# Check UFW status
sudo ufw status verbose

# Check what's listening
sudo ss -tlnp

# Open a port if needed
sudo ufw allow 443/tcp
```

## Post-Bootstrap Operator Checklist

- [ ] Bootstrap completed without errors
- [ ] DNS A records point to server IP (or CDN CNAME)
- [ ] Environment file generated with all required keys
- [ ] `./deploy/release.sh` completed successfully
- [ ] `./deploy/verify-server.sh` passes
- [ ] `./deploy/verify-release.sh` passes
- [ ] API `/health` returns 200
- [ ] Web app loads at `https://mlaffon.fun`
- [ ] Admin panel loads at `https://admin.mlaffon.fun`
- [ ] CDN verification passes (`./deploy/verify-cdn.sh`)
- [ ] Backup cron is installed (`crontab -l`)
- [ ] SSH key-based auth works
