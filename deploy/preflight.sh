#!/usr/bin/env bash
# =============================================================================
# deploy/preflight.sh — pre-deployment environment and dependency checks
# Can be sourced by release.sh or run standalone.
# Usage: ./deploy/preflight.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

PREFLIGHT_ERRORS=0
PREFLIGHT_WARNINGS=0

_pf_ok() { ok "$*"; }
_pf_fail() {
  fail "$*"
  PREFLIGHT_ERRORS=$((PREFLIGHT_ERRORS + 1))
}
_pf_warn() {
  warn "$*"
  PREFLIGHT_WARNINGS=$((PREFLIGHT_WARNINGS + 1))
}

# ── Disk space ───────────────────────────────────────────────────────────────
check_disk() {
  local min_mb="${1:-1024}"
  local avail_kb
  avail_kb=$(df -k "$MLAFFON_BASE" 2>/dev/null | awk 'NR==2{print $4}')
  if [[ -z "$avail_kb" ]]; then
    _pf_warn "Could not determine disk space for ${MLAFFON_BASE}"
    return
  fi
  local avail_mb=$((avail_kb / 1024))
  if (( avail_mb < min_mb )); then
    _pf_fail "Disk space: ${avail_mb}MB available, need at least ${min_mb}MB"
  else
    _pf_ok "Disk space: ${avail_mb}MB available"
  fi
}

# ── Memory ───────────────────────────────────────────────────────────────────
check_memory() {
  local min_mb="${1:-256}"
  local avail_mb
  avail_mb=$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')
  if [[ -z "$avail_mb" ]]; then
    _pf_warn "Could not determine available memory"
    return
  fi
  if (( avail_mb < min_mb )); then
    _pf_warn "Low memory: ${avail_mb}MB available (recommend ${min_mb}MB+)"
  else
    _pf_ok "Memory: ${avail_mb}MB available"
  fi
}

# ── Required tools ───────────────────────────────────────────────────────────
check_tools() {
  local tools=(git node npm curl jq bc psql pg_dump flock systemctl)
  for t in "${tools[@]}"; do
    if command -v "$t" &>/dev/null; then
      _pf_ok "Tool: ${t} found"
    else
      _pf_fail "Tool: ${t} not found in PATH"
    fi
  done
}

# ── Node.js version ─────────────────────────────────────────────────────────
check_node_version() {
  local required_major="${1:-20}"
  if ! command -v node &>/dev/null; then return; fi
  local ver
  ver=$(node -v 2>/dev/null | sed 's/^v//')
  local major
  major=$(echo "$ver" | cut -d. -f1)
  if (( major >= required_major )); then
    _pf_ok "Node.js: v${ver} (>= ${required_major})"
  else
    _pf_fail "Node.js: v${ver} — need >= ${required_major}"
  fi
}

# ── Environment file ────────────────────────────────────────────────────────
check_env() {
  if [[ ! -f "$SHARED_ENV" ]]; then
    _pf_fail "Shared env file missing: ${SHARED_ENV}"
    return
  fi
  _pf_ok "Shared env file exists: ${SHARED_ENV}"

  local required_keys=(DATABASE_URL REDIS_URL JWT_SECRET TELEGRAM_BOT_TOKEN TOKENS_ENCRYPTION_KEY)
  for key in "${required_keys[@]}"; do
    local val
    val=$(read_env_val "$SHARED_ENV" "$key")
    if [[ -n "$val" ]]; then
      _pf_ok "Env: ${key} is set"
    else
      _pf_fail "Env: ${key} is missing or empty in ${SHARED_ENV}"
    fi
  done

  local node_env
  node_env=$(read_env_val "$SHARED_ENV" "NODE_ENV")
  if [[ "$node_env" == "production" ]]; then
    local cors
    cors=$(read_env_val "$SHARED_ENV" "CORS_ORIGINS")
    if [[ -z "$cors" ]]; then
      _pf_fail "Production requires CORS_ORIGINS in ${SHARED_ENV}"
    fi
    local dev_auth
    dev_auth=$(read_env_val "$SHARED_ENV" "ALLOW_DEV_AUTH")
    if [[ "$dev_auth" == "1" ]]; then
      _pf_fail "ALLOW_DEV_AUTH=1 is forbidden in production"
    fi
  fi
}

# ── Database reachability ────────────────────────────────────────────────────
check_db() {
  if [[ ! -f "$SHARED_ENV" ]]; then return; fi
  local db_url
  db_url=$(read_env_val "$SHARED_ENV" "DATABASE_URL")
  if [[ -z "$db_url" ]]; then return; fi

  if psql "$db_url" -c "SELECT 1" &>/dev/null; then
    _pf_ok "PostgreSQL: reachable"
  else
    _pf_fail "PostgreSQL: cannot connect (DATABASE_URL)"
  fi
}

# ── Redis reachability ───────────────────────────────────────────────────────
check_redis() {
  if [[ ! -f "$SHARED_ENV" ]]; then return; fi
  local redis_url
  redis_url=$(read_env_val "$SHARED_ENV" "REDIS_URL")
  if [[ -z "$redis_url" ]]; then return; fi

  if command -v redis-cli &>/dev/null; then
    if redis-cli -u "$redis_url" ping 2>/dev/null | grep -qi pong; then
      _pf_ok "Redis: reachable"
    else
      _pf_fail "Redis: cannot connect (REDIS_URL)"
    fi
  else
    _pf_warn "redis-cli not found — skipping Redis check"
  fi
}

# ── Directories / permissions ────────────────────────────────────────────────
check_dirs() {
  for d in "$RELEASES_DIR" "$SHARED_DIR" "$SHARED_BACKUPS" "$SHARED_LOGS"; do
    if [[ -d "$d" ]] && [[ -w "$d" ]]; then
      _pf_ok "Directory writable: ${d}"
    elif [[ -d "$d" ]]; then
      _pf_fail "Directory not writable: ${d}"
    else
      _pf_warn "Directory does not exist yet (will be created): ${d}"
    fi
  done
}

# ── Port check ───────────────────────────────────────────────────────────────
check_port() {
  local port="${API_PORT}"
  if command -v ss &>/dev/null; then
    local listener
    listener=$(ss -tlnp "sport = :${port}" 2>/dev/null | grep -v '^State')
    if [[ -z "$listener" ]]; then
      _pf_ok "Port ${port}: free"
    elif echo "$listener" | grep -q "mlaffon-api\|node"; then
      _pf_ok "Port ${port}: in use by mlaffon-api (expected)"
    else
      _pf_warn "Port ${port}: in use by unknown process"
    fi
  else
    _pf_warn "ss not found — skipping port check"
  fi
}

# ── Caddy ────────────────────────────────────────────────────────────────────
check_caddy() {
  if command -v caddy &>/dev/null; then
    _pf_ok "Caddy: installed ($(caddy version 2>/dev/null | head -1))"
  else
    _pf_warn "Caddy: not found in PATH"
    return
  fi
  if [[ -f /etc/caddy/Caddyfile ]]; then
    _pf_ok "Caddy: Caddyfile exists"
  else
    _pf_warn "Caddy: /etc/caddy/Caddyfile not found"
  fi
}

# ── CDN provider credentials ─────────────────────────────────────────────────
check_cdn() {
  local provider="${CDN_PROVIDER:-none}"
  if [[ "$provider" == "none" ]]; then
    _pf_ok "CDN: provider=none (CDN checks disabled)"
    return
  fi

  _pf_ok "CDN: provider=${provider}"

  case "$provider" in
    yandex)
      if command -v yc &>/dev/null; then
        _pf_ok "CDN: yc CLI found"
      else
        _pf_warn "CDN: yc CLI not found — purge/verify will be limited"
      fi

      local res_id="${YC_CDN_RESOURCE_ID:-}"
      if [[ -z "$res_id" && -f "$SHARED_ENV" ]]; then
        res_id=$(read_env_val "$SHARED_ENV" "YC_CDN_RESOURCE_ID")
      fi
      if [[ -n "$res_id" ]]; then
        _pf_ok "CDN: YC_CDN_RESOURCE_ID is set"
      else
        _pf_warn "CDN: YC_CDN_RESOURCE_ID not set — purge will not work"
      fi
      ;;
    cloudflare)
      local zone="${CF_ZONE_ID:-}"
      local token="${CF_API_TOKEN:-}"
      if [[ -z "$zone" && -f "$SHARED_ENV" ]]; then
        zone=$(read_env_val "$SHARED_ENV" "CF_ZONE_ID")
      fi
      if [[ -z "$token" && -f "$SHARED_ENV" ]]; then
        token=$(read_env_val "$SHARED_ENV" "CF_API_TOKEN")
      fi
      if [[ -n "$zone" && -n "$token" ]]; then
        _pf_ok "CDN: CF_ZONE_ID and CF_API_TOKEN set"
      else
        _pf_warn "CDN: CF_ZONE_ID or CF_API_TOKEN missing — purge will not work"
      fi
      ;;
    *)
      _pf_warn "CDN: unknown provider '${provider}'"
      ;;
  esac
}

# ── Main ─────────────────────────────────────────────────────────────────────
run_preflight() {
  echo ""
  echo -e "${BOLD}Preflight checks${RESET}"
  echo -e "${BOLD}────────────────────────────────────────────${RESET}"

  check_disk
  check_memory
  check_tools
  check_node_version
  check_env
  check_db
  check_redis
  check_caddy
  check_dirs
  check_port
  check_cdn

  echo ""
  if (( PREFLIGHT_ERRORS > 0 )); then
    err "Preflight FAILED: ${PREFLIGHT_ERRORS} error(s), ${PREFLIGHT_WARNINGS} warning(s)"
    return 1
  fi

  if (( PREFLIGHT_WARNINGS > 0 )); then
    warn "Preflight passed with ${PREFLIGHT_WARNINGS} warning(s)"
  else
    log "Preflight passed — all checks OK"
  fi
  return 0
}

# Allow standalone execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_preflight
fi
