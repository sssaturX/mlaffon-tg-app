#!/usr/bin/env bash
# =============================================================================
# deploy/common.sh — shared helpers for the mlaffon deploy pipeline
# Source this file; do not execute directly.
# =============================================================================

set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────────────
export MLAFFON_BASE="${MLAFFON_BASE:-/opt/mlaffon}"
export RELEASES_DIR="${MLAFFON_BASE}/releases"
export CURRENT_LINK="${MLAFFON_BASE}/current"
export PREVIOUS_LINK="${MLAFFON_BASE}/previous"
export SHARED_DIR="${MLAFFON_BASE}/shared"
export SHARED_ENV="${SHARED_DIR}/env"
export SHARED_BACKUPS="${SHARED_DIR}/backups"
export SHARED_LOGS="${SHARED_DIR}/logs"
export DEPLOY_LOCK="${SHARED_DIR}/.deploy.lock"
export DEPLOY_HISTORY="${SHARED_DIR}/deploy-history.jsonl"
export RELEASE_RETENTION=5
export API_PORT="${API_PORT:-3001}"
export API_URL="http://127.0.0.1:${API_PORT}"
# API calls waitForDatabaseReady() before listen() (up to DB_WAIT_MAX_MS, default 120s) + seed/warmup.
# 30s is too short on small VPS; override with API_READY_TIMEOUT_SEC if needed.
export API_READY_TIMEOUT_SEC="${API_READY_TIMEOUT_SEC:-180}"

# ── Colors ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; RESET=''
fi

# ── Logging ──────────────────────────────────────────────────────────────────
_ts() { date '+%H:%M:%S'; }

log()  { echo -e "${CYAN}[$(_ts)]${RESET} $*"; }
warn() { echo -e "${YELLOW}[$(_ts)] WARN${RESET} $*" >&2; }
err()  { echo -e "${RED}[$(_ts)] ERROR${RESET} $*" >&2; }

die() {
  err "$@"
  exit 1
}

step() {
  local num="$1"; shift
  echo ""
  echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}${BLUE}  Step ${num}: $*${RESET}"
  echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${RESET}"
}

ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
fail() { echo -e "  ${RED}✗${RESET} $*"; }

# ── Retry ────────────────────────────────────────────────────────────────────
# Usage: run_retry <max_attempts> <delay_sec> <command...>
run_retry() {
  local max="$1" delay="$2"; shift 2
  local attempt=1
  while true; do
    if "$@"; then return 0; fi
    if (( attempt >= max )); then return 1; fi
    log "  attempt ${attempt}/${max} failed, retrying in ${delay}s…"
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

# ── Wait for HTTP ────────────────────────────────────────────────────────────
# Usage: wait_http <url> <timeout_sec> <interval_sec> [expected_status]
wait_http() {
  local url="$1" timeout="$2" interval="${3:-2}" expected="${4:-200}"
  local start elapsed status
  start=$(date +%s)
  while true; do
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
    if [[ "$status" == "$expected" ]]; then return 0; fi
    elapsed=$(( $(date +%s) - start ))
    if (( elapsed >= timeout )); then
      err "Timeout after ${timeout}s waiting for ${url} (last status: ${status})"
      return 1
    fi
    sleep "$interval"
  done
}

# ── Deploy lock ──────────────────────────────────────────────────────────────
LOCK_FD=
acquire_lock() {
  mkdir -p "$SHARED_DIR"
  exec 9>"$DEPLOY_LOCK"
  LOCK_FD=9
  if ! flock -n 9; then
    local holder=""
    if [[ -f "${DEPLOY_LOCK}.pid" ]]; then
      holder=" (held by PID $(cat "${DEPLOY_LOCK}.pid" 2>/dev/null || echo '?'))"
    fi
    die "Another deploy is in progress${holder}. If stale, remove ${DEPLOY_LOCK} manually."
  fi
  echo $$ > "${DEPLOY_LOCK}.pid"
  log "Deploy lock acquired (PID $$)"
}

release_lock() {
  if [[ -n "$LOCK_FD" ]]; then
    flock -u "$LOCK_FD" 2>/dev/null || true
    rm -f "${DEPLOY_LOCK}.pid"
  fi
}

# ── Env reading ──────────────────────────────────────────────────────────────
read_env_val() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || { echo ""; return 0; }
  sed -n "s/^${key}=//p" "$file" 2>/dev/null | head -1 | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# ── SUDO helper ──────────────────────────────────────────────────────────────
SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
fi

# ── Ensure directories ──────────────────────────────────────────────────────
ensure_dirs() {
  mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$SHARED_BACKUPS" "$SHARED_LOGS"
}

# ── Resolve current/previous release ────────────────────────────────────────
current_release() {
  if [[ -L "$CURRENT_LINK" ]]; then
    readlink -f "$CURRENT_LINK" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

previous_release() {
  if [[ -L "$PREVIOUS_LINK" ]]; then
    readlink -f "$PREVIOUS_LINK" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

release_id_from_path() {
  basename "$1" 2>/dev/null || echo "unknown"
}

# ── Release metadata ────────────────────────────────────────────────────────
write_release_meta() {
  local release_dir="$1"
  shift
  local json="$1"
  echo "$json" > "${release_dir}/release.json"
  echo "$json" >> "$DEPLOY_HISTORY"
}

# ── Cleanup old releases ────────────────────────────────────────────────────
cleanup_old_releases() {
  local keep="${1:-$RELEASE_RETENTION}"
  local cur prev
  cur="$(current_release)"
  prev="$(previous_release)"
  local count=0
  # list releases newest first
  for dir in $(ls -dt "$RELEASES_DIR"/*/ 2>/dev/null); do
    dir="${dir%/}"
    count=$((count + 1))
    if (( count > keep )) && [[ "$dir" != "$cur" ]] && [[ "$dir" != "$prev" ]]; then
      log "Removing old release: $(basename "$dir")"
      rm -rf "$dir"
    fi
  done
}

# ── CDN provider ─────────────────────────────────────────────────────────────
export CDN_PROVIDER="${CDN_PROVIDER:-none}"

# Read CDN_PROVIDER from shared env if not already set via environment
if [[ "$CDN_PROVIDER" == "none" && -f "$SHARED_ENV" ]]; then
  _cdn_from_env="$(read_env_val "$SHARED_ENV" "CDN_PROVIDER")"
  if [[ -n "$_cdn_from_env" ]]; then
    export CDN_PROVIDER="$_cdn_from_env"
  fi
fi

# Resolve path to a provider-specific script.
# Usage: resolve_cdn_script <script_name>
# Returns absolute path if executable, empty string otherwise.
resolve_cdn_script() {
  local script_name="$1"
  local provider="${CDN_PROVIDER:-none}"
  local script_path
  # SCRIPT_DIR may not be set if common.sh is sourced from different locations
  local base_dir="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  script_path="${base_dir}/providers/${provider}/${script_name}"
  if [[ -x "$script_path" ]]; then
    echo "$script_path"
  else
    echo ""
  fi
}

# ── Service helpers ──────────────────────────────────────────────────────────
restart_service() {
  local svc="$1"
  log "Restarting ${svc}…"
  $SUDO systemctl restart "$svc"
}

service_is_active() {
  local svc="$1"
  systemctl is-active --quiet "$svc" 2>/dev/null
}
