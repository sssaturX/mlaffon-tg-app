#!/usr/bin/env bash
# =============================================================================
# deploy/verify-server.sh — post-bootstrap server validation
#
# Validates that a VPS is fully ready for the deploy pipeline.
# Run after bootstrap.sh and before or after the first release.
#
# Usage: ./deploy/verify-server.sh
# Exit 0 = all critical checks passed, exit 1 = failures found
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

PASS=0
FAIL=0
WARN=0

_ok() {
  echo -e "  ${GREEN}✓${RESET} $*"
  PASS=$((PASS + 1))
}

_fail() {
  echo -e "  ${RED}✗${RESET} $*"
  FAIL=$((FAIL + 1))
}

_warn() {
  echo -e "  ${YELLOW}⚠${RESET} $*"
  WARN=$((WARN + 1))
}

echo ""
echo -e "${BOLD}Server validation — mlaffon-tg-app${RESET}"
echo -e "${BOLD}────────────────────────────────────────────${RESET}"

# ── 1. OS & kernel ───────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}System:${RESET}"

if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  _ok "OS: ${PRETTY_NAME:-${NAME} ${VERSION_ID}}"
else
  _warn "Cannot determine OS"
fi

TOTAL_MEM=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')
if [[ -n "$TOTAL_MEM" ]]; then
  if (( TOTAL_MEM >= 1024 )); then
    _ok "RAM: ${TOTAL_MEM}MB"
  elif (( TOTAL_MEM >= 512 )); then
    _warn "RAM: ${TOTAL_MEM}MB (1GB+ recommended)"
  else
    _fail "RAM: ${TOTAL_MEM}MB (minimum 512MB, 1GB+ recommended)"
  fi
fi

DISK_FREE_MB=$(df -m "$MLAFFON_BASE" 2>/dev/null | awk 'NR==2{print $4}')
if [[ -n "$DISK_FREE_MB" ]]; then
  if (( DISK_FREE_MB >= 5120 )); then
    _ok "Disk free: ${DISK_FREE_MB}MB"
  elif (( DISK_FREE_MB >= 2048 )); then
    _warn "Disk free: ${DISK_FREE_MB}MB (5GB+ recommended)"
  else
    _fail "Disk free: ${DISK_FREE_MB}MB (need at least 2GB)"
  fi
fi

# ── 2. Required CLI tools ───────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}CLI tools:${RESET}"

REQUIRED_TOOLS=(git node npm curl jq psql pg_dump redis-cli flock systemctl caddy bc)
for tool in "${REQUIRED_TOOLS[@]}"; do
  if command -v "$tool" &>/dev/null; then
    _ok "${tool}: found"
  else
    _fail "${tool}: NOT found"
  fi
done

# ── 3. Node.js version ─────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Node.js:${RESET}"

if command -v node &>/dev/null; then
  NODE_VER=$(node -v 2>/dev/null | sed 's/^v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if (( NODE_MAJOR >= 20 )); then
    _ok "Node.js v${NODE_VER} (>= 20)"
  else
    _fail "Node.js v${NODE_VER} — need >= 20"
  fi
fi

# ── 4. PostgreSQL ────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}PostgreSQL:${RESET}"

if systemctl is-active --quiet postgresql 2>/dev/null; then
  _ok "PostgreSQL service: running"
else
  _fail "PostgreSQL service: NOT running"
fi

if systemctl is-enabled --quiet postgresql 2>/dev/null; then
  _ok "PostgreSQL service: enabled on boot"
else
  _warn "PostgreSQL service: not enabled on boot"
fi

if [[ -f "$SHARED_ENV" ]]; then
  DB_URL=$(read_env_val "$SHARED_ENV" "DATABASE_URL")
  if [[ -n "$DB_URL" ]]; then
    if psql "$DB_URL" -c "SELECT 1" &>/dev/null; then
      _ok "PostgreSQL: reachable via DATABASE_URL"
    else
      _fail "PostgreSQL: cannot connect via DATABASE_URL"
    fi
  else
    _warn "DATABASE_URL not set in env (expected before first deploy)"
  fi
fi

# ── 5. Redis ─────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Redis:${RESET}"

if systemctl is-active --quiet redis-server 2>/dev/null || systemctl is-active --quiet redis 2>/dev/null; then
  _ok "Redis service: running"
else
  _fail "Redis service: NOT running"
fi

if command -v redis-cli &>/dev/null; then
  if redis-cli ping 2>/dev/null | grep -qi pong; then
    _ok "Redis: PONG response"
  else
    _fail "Redis: no PONG"
  fi
fi

# ── 6. Caddy ─────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Caddy:${RESET}"

if command -v caddy &>/dev/null; then
  _ok "Caddy binary: $(caddy version 2>/dev/null | head -1)"
else
  _fail "Caddy binary: NOT found"
fi

if systemctl is-enabled --quiet caddy 2>/dev/null; then
  _ok "Caddy service: enabled on boot"
else
  _warn "Caddy service: not enabled"
fi

if [[ -f /etc/caddy/Caddyfile ]]; then
  _ok "Caddyfile: /etc/caddy/Caddyfile exists"
  if caddy validate --config /etc/caddy/Caddyfile &>/dev/null; then
    _ok "Caddyfile: validates"
  else
    _warn "Caddyfile: validation failed (OK if domains don't resolve to this IP yet)"
  fi
else
  _fail "Caddyfile: /etc/caddy/Caddyfile NOT found"
fi

# ── 7. Directory structure ───────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Directory structure:${RESET}"

EXPECTED_DIRS=(
  "${MLAFFON_BASE}"
  "${MLAFFON_BASE}/releases"
  "${MLAFFON_BASE}/shared"
  "${MLAFFON_BASE}/shared/backups"
  "${MLAFFON_BASE}/shared/logs"
)

for d in "${EXPECTED_DIRS[@]}"; do
  if [[ -d "$d" ]]; then
    if [[ -w "$d" ]]; then
      _ok "${d}: exists, writable"
    else
      _fail "${d}: exists but NOT writable"
    fi
  else
    _fail "${d}: MISSING"
  fi
done

# ── 8. Git repo ──────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Git repository:${RESET}"

REPO_DIR="${MLAFFON_BASE}/repo"
if [[ -d "${REPO_DIR}/.git" ]]; then
  _ok "Repo: ${REPO_DIR} exists"
  REMOTE=$(cd "$REPO_DIR" && git remote get-url origin 2>/dev/null || echo "none")
  _ok "Remote: ${REMOTE}"
else
  _fail "Repo: ${REPO_DIR} NOT found — run: git clone <url> ${REPO_DIR}"
fi

# ── 9. Environment file ─────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Environment:${RESET}"

if [[ -f "$SHARED_ENV" ]]; then
  _ok "Env file: ${SHARED_ENV} exists"

  REQUIRED_KEYS=(DATABASE_URL REDIS_URL JWT_SECRET TELEGRAM_BOT_TOKEN TOKENS_ENCRYPTION_KEY NODE_ENV)
  for key in "${REQUIRED_KEYS[@]}"; do
    val=$(read_env_val "$SHARED_ENV" "$key")
    if [[ -n "$val" ]]; then
      _ok "Env: ${key} is set"
    else
      _fail "Env: ${key} MISSING"
    fi
  done
else
  _warn "Env file: ${SHARED_ENV} not found (run deploy/generate-env.sh)"
fi

# ── 10. systemd units ───────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}systemd units:${RESET}"

UNITS=(mlaffon-api mlaffon-worker mlaffon-worker-fraud)
for svc in "${UNITS[@]}"; do
  if [[ -f "/etc/systemd/system/${svc}.service" ]]; then
    _ok "${svc}.service: installed"
  else
    _fail "${svc}.service: NOT installed"
  fi
done

# ── 11. Firewall ─────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Firewall:${RESET}"

if command -v ufw &>/dev/null; then
  UFW_STATUS=$(ufw status 2>/dev/null | head -1)
  if echo "$UFW_STATUS" | grep -qi "active"; then
    _ok "UFW: active"
    # Check critical ports
    if ufw status 2>/dev/null | grep -q "22/tcp"; then
      _ok "UFW: SSH (22) allowed"
    else
      _warn "UFW: SSH (22) rule not found"
    fi
    if ufw status 2>/dev/null | grep -q "443/tcp"; then
      _ok "UFW: HTTPS (443) allowed"
    else
      _warn "UFW: HTTPS (443) rule not found"
    fi
  else
    _warn "UFW: inactive"
  fi
else
  _warn "UFW: not installed"
fi

# ── 12. Ports ────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Ports:${RESET}"

if command -v ss &>/dev/null; then
  for port in 80 443 5432 6379; do
    LISTENER=$(ss -tlnp "sport = :${port}" 2>/dev/null | grep -v '^State' | head -1)
    if [[ -n "$LISTENER" ]]; then
      _ok "Port ${port}: listening"
    else
      _warn "Port ${port}: not listening"
    fi
  done
fi

# ── 13. CDN provider ────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}CDN:${RESET}"

_ok "CDN_PROVIDER: ${CDN_PROVIDER}"

if [[ "$CDN_PROVIDER" == "yandex" ]]; then
  if command -v yc &>/dev/null; then
    _ok "yc CLI: installed"
  else
    _warn "yc CLI: not installed (needed for purge)"
  fi

  RESOURCE_ID="${YC_CDN_RESOURCE_ID:-}"
  if [[ -z "$RESOURCE_ID" && -f "$SHARED_ENV" ]]; then
    RESOURCE_ID=$(read_env_val "$SHARED_ENV" "YC_CDN_RESOURCE_ID")
  fi
  if [[ -n "$RESOURCE_ID" ]]; then
    _ok "YC_CDN_RESOURCE_ID: set"
  else
    _warn "YC_CDN_RESOURCE_ID: not set"
  fi
fi

# ── 14. Backup cron ─────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Backup:${RESET}"

if crontab -l 2>/dev/null | grep -q "backup.sh"; then
  _ok "Backup cron: configured"
else
  CRON_USER=$(stat -c '%U' "${MLAFFON_BASE}" 2>/dev/null || echo "www-data")
  if crontab -u "$CRON_USER" -l 2>/dev/null | grep -q "backup.sh"; then
    _ok "Backup cron: configured (user: ${CRON_USER})"
  else
    _warn "Backup cron: NOT configured"
  fi
fi

# ── 15. Current deployment ──────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Deployment:${RESET}"

if [[ -L "$CURRENT_LINK" ]]; then
  CUR=$(readlink -f "$CURRENT_LINK" 2>/dev/null)
  _ok "Current release: $(basename "$CUR")"

  # API health
  HEALTH=$(curl -s --max-time 5 "${API_URL}/health" 2>/dev/null || echo "")
  if [[ -n "$HEALTH" ]]; then
    _ok "API /health: responding"
  else
    _warn "API /health: not responding (service may not be started)"
  fi
else
  _warn "No current release (first deploy not yet run)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}────────────────────────────────────────────${RESET}"

if (( FAIL > 0 )); then
  echo -e "${RED}${BOLD}VALIDATION: ${PASS} passed, ${FAIL} failed, ${WARN} warnings${RESET}"
  echo ""
  exit 1
elif (( WARN > 0 )); then
  echo -e "${YELLOW}${BOLD}VALIDATION: ${PASS} passed, ${WARN} warnings${RESET}"
  echo ""
else
  echo -e "${GREEN}${BOLD}VALIDATION: ${PASS} checks passed — server is ready${RESET}"
  echo ""
fi
