#!/usr/bin/env bash
# =============================================================================
# deploy/bootstrap.sh — production VPS bootstrap for mlaffon-tg-app
#
# Takes a fresh Ubuntu 22.04/24.04 VPS from zero to deploy-ready in one run.
# Must be executed as root (or via sudo).
#
# Usage:
#   sudo ./deploy/bootstrap.sh                     # full setup
#   sudo ./deploy/bootstrap.sh --skip-db           # skip PostgreSQL setup
#   sudo ./deploy/bootstrap.sh --skip-redis        # skip Redis setup
#   sudo ./deploy/bootstrap.sh --skip-caddy        # skip Caddy setup
#   sudo ./deploy/bootstrap.sh --skip-firewall     # skip UFW setup
#   sudo ./deploy/bootstrap.sh --app-user deploy   # custom app user (default: www-data)
#
# After bootstrap:
#   1. Run  ./deploy/generate-env.sh  to create /opt/mlaffon/shared/env
#   2. Run  ./deploy/release.sh <tag>  to deploy the first release
#   3. Run  ./deploy/verify-server.sh  to validate everything
#
# See docs/server-bootstrap.md for the full operator guide.
# =============================================================================

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
SKIP_DB=0
SKIP_REDIS=0
SKIP_CADDY=0
SKIP_FIREWALL=0
APP_USER="www-data"
MLAFFON_BASE="/opt/mlaffon"
NODE_MAJOR=20
PG_VERSION=16
REPO_URL="${REPO_URL:-}"

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-db)       SKIP_DB=1 ;;
    --skip-redis)    SKIP_REDIS=1 ;;
    --skip-caddy)    SKIP_CADDY=1 ;;
    --skip-firewall) SKIP_FIREWALL=1 ;;
    --app-user)      APP_USER="$2"; shift ;;
    --repo-url)      REPO_URL="$2"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# ── Colors & logging ────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

_ts()  { date '+%H:%M:%S'; }
log()  { echo -e "${CYAN}[$(_ts)]${RESET} $*"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}[$(_ts)] WARN${RESET} $*" >&2; }
err()  { echo -e "${RED}[$(_ts)] ERROR${RESET} $*" >&2; }
die()  { err "$@"; exit 1; }

step() {
  local num="$1"; shift
  echo ""
  echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}${BLUE}  Step ${num}: $*${RESET}"
  echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${RESET}"
}

# ── Root check ───────────────────────────────────────────────────────────────
if [[ "$(id -u)" -ne 0 ]]; then
  die "This script must be run as root (use sudo)"
fi

BOOTSTRAP_START=$(date +%s)

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║        mlaffon VPS bootstrap — server setup                 ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
log "App user:    ${APP_USER}"
log "Base dir:    ${MLAFFON_BASE}"
log "Node.js:     v${NODE_MAJOR}.x LTS"
log "PostgreSQL:  ${PG_VERSION}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 1: System update & base packages
# ═══════════════════════════════════════════════════════════════════════════════
step 1 "System update & base packages"

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get upgrade -y -qq

PACKAGES=(
  curl wget git jq bc unzip gnupg
  build-essential ca-certificates lsb-release
  ufw logrotate
  software-properties-common apt-transport-https
)

apt-get install -y -qq "${PACKAGES[@]}"
ok "Base packages installed"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 2: App user
# ═══════════════════════════════════════════════════════════════════════════════
step 2 "App user (${APP_USER})"

if [[ "$APP_USER" != "www-data" ]]; then
  if ! id "$APP_USER" &>/dev/null; then
    useradd --system --create-home --shell /bin/bash "$APP_USER"
    ok "User ${APP_USER} created"
  else
    ok "User ${APP_USER} already exists"
  fi
  usermod -aG sudo "$APP_USER" 2>/dev/null || true
else
  ok "Using system user www-data"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: Node.js
# ═══════════════════════════════════════════════════════════════════════════════
step 3 "Node.js v${NODE_MAJOR}.x"

if command -v node &>/dev/null; then
  CURRENT_NODE=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  if (( CURRENT_NODE >= NODE_MAJOR )); then
    ok "Node.js already installed: $(node -v)"
  else
    warn "Node.js $(node -v) is too old, installing v${NODE_MAJOR}.x"
    INSTALL_NODE=1
  fi
else
  INSTALL_NODE=1
fi

if [[ "${INSTALL_NODE:-0}" == "1" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  ok "Node.js installed: $(node -v)"
fi

# Verify npm
if command -v npm &>/dev/null; then
  ok "npm: $(npm -v)"
else
  die "npm not found after Node.js installation"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: PostgreSQL
# ═══════════════════════════════════════════════════════════════════════════════
step 4 "PostgreSQL ${PG_VERSION}"

if (( SKIP_DB )); then
  warn "Skipping PostgreSQL setup (--skip-db)"
else
  if command -v psql &>/dev/null && psql --version 2>/dev/null | grep -q "${PG_VERSION}"; then
    ok "PostgreSQL ${PG_VERSION} already installed"
  else
    # Add PostgreSQL APT repository
    if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
      curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg
      echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
      apt-get update -qq
    fi
    apt-get install -y -qq "postgresql-${PG_VERSION}" postgresql-client
    ok "PostgreSQL ${PG_VERSION} installed"
  fi

  systemctl enable postgresql
  systemctl start postgresql
  ok "PostgreSQL enabled and running"

  # Create database and user (idempotent)
  DB_NAME="mlaffon"
  DB_USER="mlaffon"
  DB_PASS=$(openssl rand -hex 16)

  # Check if user exists
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" 2>/dev/null | grep -q 1; then
    ok "PostgreSQL user '${DB_USER}' already exists"
  else
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null
    ok "PostgreSQL user '${DB_USER}' created (password saved below)"
  fi

  # Check if database exists
  if sudo -u postgres psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw "${DB_NAME}"; then
    ok "PostgreSQL database '${DB_NAME}' already exists"
  else
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null
    ok "PostgreSQL database '${DB_NAME}' created"
  fi

  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" 2>/dev/null || true

  # pg_hba.conf: ensure local md5/scram auth
  PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
  if [[ -f "$PG_HBA" ]]; then
    # Ensure the mlaffon user can connect locally with password
    if ! grep -q "mlaffon" "$PG_HBA" 2>/dev/null; then
      sed -i '/^# IPv4 local connections:/a host    mlaffon         mlaffon         127.0.0.1/32            scram-sha-256' "$PG_HBA"
      systemctl reload postgresql
      ok "pg_hba.conf updated for local password auth"
    fi
  fi

  # postgresql.conf: logging
  PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
  if [[ -f "$PG_CONF" ]]; then
    # Enable query logging for slow queries
    if ! grep -q "log_min_duration_statement" "$PG_CONF" 2>/dev/null || grep -q "^#log_min_duration_statement" "$PG_CONF" 2>/dev/null; then
      cat >> "$PG_CONF" <<'EOF'

# mlaffon: log slow queries
log_min_duration_statement = 1000
log_connections = on
log_disconnections = on
EOF
      systemctl reload postgresql
      ok "PostgreSQL logging configured"
    fi
  fi

  DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"
  echo ""
  echo -e "  ${BOLD}Database URL (save this for env setup):${RESET}"
  echo -e "  ${GREEN}${DATABASE_URL}${RESET}"
  echo ""
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 5: Redis
# ═══════════════════════════════════════════════════════════════════════════════
step 5 "Redis"

if (( SKIP_REDIS )); then
  warn "Skipping Redis setup (--skip-redis)"
else
  if command -v redis-server &>/dev/null; then
    ok "Redis already installed: $(redis-server --version | head -1)"
  else
    apt-get install -y -qq redis-server
    ok "Redis installed"
  fi

  systemctl enable redis-server
  systemctl start redis-server

  # Harden redis.conf
  REDIS_CONF="/etc/redis/redis.conf"
  if [[ -f "$REDIS_CONF" ]]; then
    # bind to localhost only
    sed -i 's/^bind .*/bind 127.0.0.1 ::1/' "$REDIS_CONF" 2>/dev/null || true
    # enable protected mode
    sed -i 's/^# protected-mode yes/protected-mode yes/' "$REDIS_CONF" 2>/dev/null || true
    sed -i 's/^protected-mode no/protected-mode yes/' "$REDIS_CONF" 2>/dev/null || true
    # set maxmemory policy
    if ! grep -q "^maxmemory-policy" "$REDIS_CONF" 2>/dev/null; then
      echo "maxmemory-policy allkeys-lru" >> "$REDIS_CONF"
    fi
    systemctl restart redis-server
    ok "Redis hardened (bind localhost, protected-mode)"
  fi

  # Verify connectivity
  if redis-cli ping 2>/dev/null | grep -qi pong; then
    ok "Redis: PONG response"
  else
    warn "Redis: no PONG (may need a moment to start)"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 6: Caddy
# ═══════════════════════════════════════════════════════════════════════════════
step 6 "Caddy reverse proxy"

if (( SKIP_CADDY )); then
  warn "Skipping Caddy setup (--skip-caddy)"
else
  if command -v caddy &>/dev/null; then
    ok "Caddy already installed: $(caddy version 2>/dev/null | head -1)"
  else
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
    ok "Caddy installed"
  fi

  systemctl enable caddy

  # Copy Caddyfile if the deploy directory is available
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${SCRIPT_DIR}/Caddyfile" ]]; then
    cp "${SCRIPT_DIR}/Caddyfile" /etc/caddy/Caddyfile
    caddy fmt --overwrite /etc/caddy/Caddyfile 2>/dev/null || true
    if caddy validate --config /etc/caddy/Caddyfile 2>/dev/null; then
      ok "Caddyfile installed and validated"
    else
      warn "Caddyfile installed but validation failed (domains may not resolve yet)"
    fi
  else
    warn "deploy/Caddyfile not found — install it manually later"
  fi

  # Don't start Caddy yet — it needs the app to exist at /opt/mlaffon/current
  ok "Caddy enabled (will start after first deploy)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 7: Directory structure
# ═══════════════════════════════════════════════════════════════════════════════
step 7 "Directory structure"

DIRS=(
  "${MLAFFON_BASE}"
  "${MLAFFON_BASE}/releases"
  "${MLAFFON_BASE}/shared"
  "${MLAFFON_BASE}/shared/backups"
  "${MLAFFON_BASE}/shared/logs"
)

for d in "${DIRS[@]}"; do
  mkdir -p "$d"
done

chown -R "${APP_USER}:${APP_USER}" "${MLAFFON_BASE}"
chmod 755 "${MLAFFON_BASE}"
ok "Directory tree created: ${MLAFFON_BASE}/{releases,shared/{backups,logs}}"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 8: Git repo clone
# ═══════════════════════════════════════════════════════════════════════════════
step 8 "Git repository"

REPO_DIR="${MLAFFON_BASE}/repo"
if [[ -d "${REPO_DIR}/.git" ]]; then
  ok "Git repo already exists at ${REPO_DIR}"
  cd "$REPO_DIR"
  sudo -u "${APP_USER}" git fetch --all --prune 2>/dev/null || warn "git fetch failed (may need SSH key)"
else
  if [[ -n "$REPO_URL" ]]; then
    sudo -u "${APP_USER}" git clone "$REPO_URL" "$REPO_DIR"
    ok "Repo cloned from ${REPO_URL}"
  else
    warn "No repo at ${REPO_DIR} and --repo-url not provided"
    warn "Clone manually: sudo -u ${APP_USER} git clone <url> ${REPO_DIR}"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 9: systemd unit files
# ═══════════════════════════════════════════════════════════════════════════════
step 9 "systemd service units"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICES=(mlaffon-api mlaffon-worker mlaffon-worker-fraud)

for svc in "${SERVICES[@]}"; do
  SVC_FILE="${SCRIPT_DIR}/${svc}.service"
  if [[ -f "$SVC_FILE" ]]; then
    cp "$SVC_FILE" "/etc/systemd/system/${svc}.service"
    ok "Installed ${svc}.service"
  else
    warn "${svc}.service not found at ${SVC_FILE}"
  fi
done

systemctl daemon-reload

for svc in "${SERVICES[@]}"; do
  systemctl enable "${svc}" 2>/dev/null || true
done

ok "systemd units installed and enabled (will start after first deploy)"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 10: Firewall (UFW)
# ═══════════════════════════════════════════════════════════════════════════════
step 10 "Firewall (UFW)"

if (( SKIP_FIREWALL )); then
  warn "Skipping firewall setup (--skip-firewall)"
else
  ufw --force reset 2>/dev/null || true
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment 'SSH'
  ufw allow 80/tcp comment 'HTTP'
  ufw allow 443/tcp comment 'HTTPS'
  ufw --force enable
  ok "UFW enabled: allow SSH(22), HTTP(80), HTTPS(443)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 11: SSH hardening
# ═══════════════════════════════════════════════════════════════════════════════
step 11 "SSH hardening"

SSHD_CONF="/etc/ssh/sshd_config"
if [[ -f "$SSHD_CONF" ]]; then
  SSHD_CHANGED=0

  # Disable root login via password (allow key-based if needed)
  if grep -q "^PermitRootLogin yes" "$SSHD_CONF" 2>/dev/null; then
    sed -i 's/^PermitRootLogin yes/PermitRootLogin prohibit-password/' "$SSHD_CONF"
    SSHD_CHANGED=1
  fi

  # Disable password authentication if SSH keys are present
  if [[ -d /root/.ssh ]] && [[ -f /root/.ssh/authorized_keys ]] && [[ -s /root/.ssh/authorized_keys ]]; then
    if grep -q "^PasswordAuthentication yes" "$SSHD_CONF" 2>/dev/null; then
      sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' "$SSHD_CONF"
      SSHD_CHANGED=1
      ok "Password auth disabled (SSH keys detected)"
    fi
  else
    warn "No SSH keys detected — password auth left enabled"
  fi

  if (( SSHD_CHANGED )); then
    systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true
    ok "sshd config updated"
  else
    ok "sshd config already hardened"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 12: Backup cron
# ═══════════════════════════════════════════════════════════════════════════════
step 12 "Backup cron"

CRON_LINE="0 2 * * * /opt/mlaffon/current/deploy/backup.sh >> /opt/mlaffon/shared/logs/backup-cron.log 2>&1"
EXISTING_CRON=$(crontab -u "${APP_USER}" -l 2>/dev/null || echo "")

if echo "$EXISTING_CRON" | grep -q "backup.sh"; then
  ok "Backup cron already configured"
else
  (echo "$EXISTING_CRON"; echo "$CRON_LINE") | crontab -u "${APP_USER}" -
  ok "Daily backup cron installed (02:00 AM)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 13: Logrotate
# ═══════════════════════════════════════════════════════════════════════════════
step 13 "Logrotate"

cat > /etc/logrotate.d/mlaffon <<'LOGROTATE'
/opt/mlaffon/shared/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
}
LOGROTATE

ok "Logrotate configured for /opt/mlaffon/shared/logs/"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 14: Make deploy scripts executable
# ═══════════════════════════════════════════════════════════════════════════════
step 14 "Script permissions"

if [[ -d "${REPO_DIR}/deploy" ]]; then
  find "${REPO_DIR}/deploy" -name "*.sh" -exec chmod +x {} \;
  ok "All deploy/*.sh scripts marked executable"
else
  warn "Repo not cloned yet — run chmod +x deploy/*.sh after cloning"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
BOOTSTRAP_END=$(date +%s)
DURATION=$((BOOTSTRAP_END - BOOTSTRAP_START))

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║                    Bootstrap Complete                        ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Duration:   ${DURATION}s"
echo -e "  App user:   ${APP_USER}"
echo -e "  Base dir:   ${MLAFFON_BASE}"
echo -e "  Node.js:    $(node -v 2>/dev/null || echo 'not installed')"
echo -e "  PostgreSQL: $(psql --version 2>/dev/null | head -1 || echo 'not installed')"
echo -e "  Redis:      $(redis-server --version 2>/dev/null | head -1 || echo 'not installed')"
echo -e "  Caddy:      $(caddy version 2>/dev/null | head -1 || echo 'not installed')"
echo ""

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo -e "  ${BOLD}${YELLOW}Save this DATABASE_URL for env setup:${RESET}"
  echo -e "  ${DATABASE_URL}"
  echo ""
fi

echo -e "  ${BOLD}Next steps:${RESET}"
echo ""
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo -e "  1. Clone the repo:"
  echo -e "     sudo -u ${APP_USER} git clone <repo-url> ${REPO_DIR}"
  echo ""
fi
echo -e "  2. Generate the environment file:"
echo -e "     sudo -u ${APP_USER} ${REPO_DIR}/deploy/generate-env.sh"
echo ""
echo -e "  3. Deploy the first release:"
echo -e "     sudo -u ${APP_USER} ${REPO_DIR}/deploy/release.sh <tag-or-sha>"
echo ""
echo -e "  4. Validate the server:"
echo -e "     ${REPO_DIR}/deploy/verify-server.sh"
echo ""
echo -e "  See ${BOLD}docs/server-bootstrap.md${RESET} for the full guide."
echo ""
