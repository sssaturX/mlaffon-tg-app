#!/usr/bin/env bash
# =============================================================================
# deploy/release.sh — production deploy pipeline orchestrator
#
# Creates a timestamped release directory, builds, migrates, switches the
# atomic symlink, restarts services, runs verification gates, and auto-rolls
# back on post-switch failure.
#
# Usage:
#   ./deploy/release.sh                 # deploy latest main
#   ./deploy/release.sh v1.2.3          # deploy a tag
#   ./deploy/release.sh abc1234         # deploy a specific SHA
#   ./deploy/release.sh --dry-run       # preflight only, no changes
#
# Environment variables (optional overrides):
#   MLAFFON_BASE=/opt/mlaffon           # base directory
#   API_PORT=3001                       # API listen port
#   DEPLOY_SKIP_BACKUP=0               # skip pre-deploy backup
#   DEPLOY_SKIP_MIGRATIONS=0           # skip SQL file + drizzle push
#   DEPLOY_SKIP_CDN=0                  # skip CDN validation
#   DEPLOY_SKIP_WARMUP=0               # skip cache warmup
#   DEPLOY_ALLOW_DESTRUCTIVE=0         # pass --force to drizzle push
#   DEPLOY_SKIP_FAQ_SYNC=0             # skip db:sync-faq
#   DEPLOY_DB_SEED=0                   # run db:seed (default: 0)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

DEPLOY_START=$(date +%s)
DEPLOY_START_ISO=$(date -Iseconds)
RELEASE_DIR=""
SWITCHED=0
TARGET_REF="${1:-main}"
DRY_RUN=0

if [[ "$TARGET_REF" == "--dry-run" ]]; then
  DRY_RUN=1
  TARGET_REF="${2:-main}"
fi

DEPLOY_LOG="${SHARED_LOGS}/deploy-$(date +%Y%m%d_%H%M%S).log"

# ── Trap: auto-rollback on error after symlink switch ────────────────────────
auto_rollback() {
  local exit_code=$?
  release_lock

  if (( SWITCHED == 1 )) && (( exit_code != 0 )); then
    echo ""
    err "═══════════════════════════════════════════════════════════"
    err "  DEPLOY FAILED AFTER SYMLINK SWITCH — AUTO-ROLLBACK"
    err "═══════════════════════════════════════════════════════════"

    local prev
    prev="$(previous_release)"
    if [[ -n "$prev" && -d "$prev" ]]; then
      log "Rolling back to: $(release_id_from_path "$prev")"
      ln -sfn "$prev" "$CURRENT_LINK"
      $SUDO systemctl restart mlaffon-api mlaffon-worker mlaffon-worker-fraud 2>/dev/null || true

      log "Waiting for previous release health…"
      if wait_http "${API_URL}/health/ready" "${API_READY_TIMEOUT_SEC}" 2; then
        ok "Rollback successful — previous release is healthy"
        write_release_meta "$prev" "$(cat <<ENDJSON
{"release":"$(release_id_from_path "$prev")","action":"rollback","timestamp":"$(date -Iseconds)","reason":"deploy_failure","exit_code":${exit_code}}
ENDJSON
)"
      else
        err "CRITICAL: Rollback health check FAILED"
        err "Manual intervention required!"
        err "  1. Check: journalctl -u mlaffon-api -n 50"
        err "  2. Try:   systemctl restart mlaffon-api"
        err "  3. Docs:  docs/runbooks-deploy.md"
      fi
    else
      err "No previous release to rollback to!"
      err "Manual intervention required."
    fi
  fi

  # Clean up incomplete release dir on pre-switch failure
  if (( SWITCHED == 0 )) && (( exit_code != 0 )) && [[ -n "$RELEASE_DIR" && -d "$RELEASE_DIR" ]]; then
    log "Cleaning up incomplete release: $(basename "$RELEASE_DIR")"
    rm -rf "$RELEASE_DIR"
  fi
}

trap auto_rollback EXIT

# ── Logging tee ──────────────────────────────────────────────────────────────
mkdir -p "$SHARED_LOGS"
exec > >(tee -a "$DEPLOY_LOG") 2>&1

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║          mlaffon deploy pipeline — release.sh               ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
log "Target ref:  ${TARGET_REF}"
log "Base dir:    ${MLAFFON_BASE}"
log "CDN provider: ${CDN_PROVIDER}"
log "Timestamp:   ${DEPLOY_START_ISO}"
log "Deploy log:  ${DEPLOY_LOG}"
if (( DRY_RUN )); then log "Mode: DRY RUN (preflight only)"; fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 1: Acquire deploy lock
# ═══════════════════════════════════════════════════════════════════════════════
step 1 "Acquire deploy lock"
acquire_lock

# ═══════════════════════════════════════════════════════════════════════════════
# Step 2: Preflight checks
# ═══════════════════════════════════════════════════════════════════════════════
step 2 "Preflight checks"
# shellcheck source=./preflight.sh
source "${SCRIPT_DIR}/preflight.sh"
run_preflight || die "Preflight failed — aborting deploy"

if (( DRY_RUN )); then
  log "Dry run complete. No changes made."
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: Resolve target SHA
# ═══════════════════════════════════════════════════════════════════════════════
step 3 "Resolve release target"
REPO_DIR="${MLAFFON_BASE}/repo"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  die "Git repo not found at ${REPO_DIR}. Clone it first: git clone <url> ${REPO_DIR}"
fi

cd "$REPO_DIR"
log "Fetching latest from origin…"
git fetch --all --tags --prune

if git rev-parse "refs/tags/${TARGET_REF}" &>/dev/null; then
  TARGET_SHA=$(git rev-parse "refs/tags/${TARGET_REF}")
  log "Resolved tag ${TARGET_REF} → ${TARGET_SHA:0:7}"
elif git rev-parse "${TARGET_REF}" &>/dev/null; then
  TARGET_SHA=$(git rev-parse "${TARGET_REF}")
  log "Resolved ref ${TARGET_REF} → ${TARGET_SHA:0:7}"
elif git rev-parse "origin/${TARGET_REF}" &>/dev/null; then
  TARGET_SHA=$(git rev-parse "origin/${TARGET_REF}")
  log "Resolved branch origin/${TARGET_REF} → ${TARGET_SHA:0:7}"
else
  die "Cannot resolve ref: ${TARGET_REF}"
fi

SHA7="${TARGET_SHA:0:7}"
RELEASE_ID="$(date +%Y%m%d_%H%M%S)_${SHA7}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"

CUR_RELEASE="$(current_release)"
if [[ -n "$CUR_RELEASE" ]]; then
  CUR_SHA=$(cd "$CUR_RELEASE" && git rev-parse HEAD 2>/dev/null || echo "unknown")
  if [[ "${CUR_SHA}" == "${TARGET_SHA}" ]]; then
    warn "Target SHA (${SHA7}) is the same as the current release"
    warn "Continuing anyway (rebuild/restart may be intended)"
  fi
fi

log "Release ID:  ${RELEASE_ID}"
log "Release dir: ${RELEASE_DIR}"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: Create release directory
# ═══════════════════════════════════════════════════════════════════════════════
step 4 "Create release directory"
ensure_dirs
mkdir -p "$RELEASE_DIR"
log "Cloning repo at ${SHA7} into release dir…"
git clone --no-checkout "$REPO_DIR" "$RELEASE_DIR"
cd "$RELEASE_DIR"
git checkout "$TARGET_SHA"
ok "Release dir ready: ${RELEASE_DIR}"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 5: Link shared env
# ═══════════════════════════════════════════════════════════════════════════════
step 5 "Link shared environment"
if [[ ! -f "$SHARED_ENV" ]]; then
  die "Shared env file missing: ${SHARED_ENV}"
fi
ln -sfn "$SHARED_ENV" "${RELEASE_DIR}/apps/api/.env"
ok "Linked ${RELEASE_DIR}/apps/api/.env → ${SHARED_ENV}"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 6: Install dependencies
# ═══════════════════════════════════════════════════════════════════════════════
step 6 "Install dependencies (npm ci)"
cd "$RELEASE_DIR"
npm ci --prefer-offline 2>&1
ok "Dependencies installed"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 7: Build
# ═══════════════════════════════════════════════════════════════════════════════
step 7 "Build (API + Web + Admin)"
cd "$RELEASE_DIR"

GIT_COMMIT="$SHA7"
BUILD_TIME="$(date -Iseconds)"
export GIT_COMMIT BUILD_TIME

npm run build 2>&1
ok "Build complete"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 8: Verify build artifacts
# ═══════════════════════════════════════════════════════════════════════════════
step 8 "Verify build artifacts"
ARTIFACTS=(
  "apps/api/dist/index.js"
  "apps/web/dist/index.html"
  "apps/admin/dist/index.html"
)
for artifact in "${ARTIFACTS[@]}"; do
  if [[ -f "${RELEASE_DIR}/${artifact}" ]]; then
    ok "Found: ${artifact}"
  else
    die "Missing build artifact: ${artifact}"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# Step 9: Pre-deploy database backup
# ═══════════════════════════════════════════════════════════════════════════════
step 9 "Pre-deploy database backup"
if [[ "${DEPLOY_SKIP_BACKUP:-0}" == "1" ]]; then
  warn "Skipping backup (DEPLOY_SKIP_BACKUP=1)"
else
  if [[ -x "${SCRIPT_DIR}/backup.sh" ]]; then
    "${SCRIPT_DIR}/backup.sh" --pre-deploy "$SHA7" || die "Pre-deploy backup failed"
    ok "Backup complete"
  else
    warn "backup.sh not found or not executable — skipping"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 10: Run migrations
# ═══════════════════════════════════════════════════════════════════════════════
step 10 "Database migrations"
if [[ "${DEPLOY_SKIP_MIGRATIONS:-0}" == "1" ]]; then
  warn "Skipping migrations (DEPLOY_SKIP_MIGRATIONS=1)"
else
  cd "${RELEASE_DIR}/apps/api"

  # Ручные idempotent SQL в apps/api/drizzle/*.sql — drizzle-kit push их не выполняет.
  API_ENV="${RELEASE_DIR}/apps/api/.env"
  DB_URL="$(read_env_val "$API_ENV" "DATABASE_URL")"
  [[ -n "$DB_URL" ]] || die "DATABASE_URL missing in ${API_ENV} (needed for migrations)"
  command -v psql &>/dev/null || die "psql not found (install postgresql-client; required for SQL migrations)"

  SHOP_MIG_SQL="${RELEASE_DIR}/apps/api/drizzle/0006_shop_purchases_item_snapshot_fk.sql"
  if [[ -f "$SHOP_MIG_SQL" ]]; then
    log "Applying idempotent SQL: $(basename "$SHOP_MIG_SQL") (shop_purchases snapshot / FK)"
    run_retry 3 5 psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SHOP_MIG_SQL" 2>&1 ||
      die "SQL migration failed: 0006_shop_purchases_item_snapshot_fk.sql"
    ok "SQL migration applied"
  else
    warn "Expected file missing: apps/api/drizzle/0006_shop_purchases_item_snapshot_fk.sql — skip SQL step"
  fi

  DRIZZLE_ARGS=""
  if [[ "${DEPLOY_ALLOW_DESTRUCTIVE:-0}" == "1" ]]; then
    DRIZZLE_ARGS="--force"
    warn "Destructive migrations allowed (DEPLOY_ALLOW_DESTRUCTIVE=1)"
  fi

  log "Running drizzle-kit push…"
  run_retry 3 5 npx drizzle-kit push $DRIZZLE_ARGS 2>&1 || die "Migration failed after retries"
  ok "drizzle-kit push applied"

  if [[ "${DEPLOY_SKIP_FAQ_SYNC:-0}" != "1" ]]; then
    log "Running db:sync-faq…"
    run_retry 3 3 npm run db:sync-faq 2>&1 || warn "db:sync-faq failed (non-blocking)"
  fi

  if [[ "${DEPLOY_DB_SEED:-0}" == "1" ]]; then
    log "Running db:seed…"
    run_retry 3 3 npm run db:seed 2>&1 || warn "db:seed failed (non-blocking)"
  fi

  cd "$RELEASE_DIR"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 11: Set permissions
# ═══════════════════════════════════════════════════════════════════════════════
step 11 "Set file permissions"
$SUDO chmod -R o+rX "${RELEASE_DIR}/apps/api/dist" 2>/dev/null || true
$SUDO chmod -R o+rX "${RELEASE_DIR}/apps/web/dist" 2>/dev/null || true
$SUDO chmod -R o+rX "${RELEASE_DIR}/apps/admin/dist" 2>/dev/null || true
if [[ -d "${RELEASE_DIR}/apps/api/assets" ]]; then
  $SUDO chmod -R o+rX "${RELEASE_DIR}/apps/api/assets" 2>/dev/null || true
fi
ok "Permissions set"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 12: Atomic symlink switch
# ═══════════════════════════════════════════════════════════════════════════════
step 12 "Atomic symlink switch"

# Save current as previous
if [[ -L "$CURRENT_LINK" ]]; then
  PREV_TARGET=$(readlink -f "$CURRENT_LINK")
  ln -sfn "$PREV_TARGET" "$PREVIOUS_LINK"
  log "Previous release: $(release_id_from_path "$PREV_TARGET")"
fi

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
SWITCHED=1
ok "Switched: current → ${RELEASE_ID}"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 13: Install/reload systemd units
# ═══════════════════════════════════════════════════════════════════════════════
step 13 "Install systemd units"
UNITS=(mlaffon-api.service mlaffon-worker.service mlaffon-worker-fraud.service)
for unit in "${UNITS[@]}"; do
  if [[ -f "${RELEASE_DIR}/deploy/${unit}" ]]; then
    $SUDO cp "${RELEASE_DIR}/deploy/${unit}" "/etc/systemd/system/${unit}"
    ok "Installed: ${unit}"
  fi
done
$SUDO systemctl daemon-reload
ok "systemd daemon-reload complete"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 14: Restart API
# ═══════════════════════════════════════════════════════════════════════════════
step 14 "Restart API server"
restart_service mlaffon-api
log "Waiting for API readiness…"
wait_http "${API_URL}/health/ready" "${API_READY_TIMEOUT_SEC}" 2 || die "API did not become ready within ${API_READY_TIMEOUT_SEC}s (set API_READY_TIMEOUT_SEC if startup is slower)"
ok "API is ready"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 15: Restart workers
# ═══════════════════════════════════════════════════════════════════════════════
step 15 "Restart workers"
restart_service mlaffon-worker
if systemctl list-unit-files mlaffon-worker-fraud.service &>/dev/null; then
  restart_service mlaffon-worker-fraud
fi
sleep 2
for svc in mlaffon-worker mlaffon-worker-fraud; do
  if service_is_active "$svc"; then
    ok "${svc} is active"
  elif systemctl list-unit-files "${svc}.service" &>/dev/null 2>&1; then
    warn "${svc} is not active"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# Step 16: Smoke tests
# ═══════════════════════════════════════════════════════════════════════════════
step 16 "Smoke tests"
if [[ -x "${SCRIPT_DIR}/smoke-test.sh" ]]; then
  "${SCRIPT_DIR}/smoke-test.sh" "${API_URL}" || die "Smoke tests failed"
  ok "Smoke tests passed"
else
  warn "smoke-test.sh not found — skipping"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 17: Version verification
# ═══════════════════════════════════════════════════════════════════════════════
step 17 "Version verification"
LIVE_COMMIT=$(curl -s --max-time 5 "${API_URL}/version" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null || echo "")
if [[ "$LIVE_COMMIT" == "$SHA7" ]]; then
  ok "Live version matches: ${LIVE_COMMIT}"
elif [[ -n "$LIVE_COMMIT" ]]; then
  warn "Version mismatch: live=${LIVE_COMMIT}, expected=${SHA7}"
else
  warn "Could not read /version endpoint"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 18: Cache warmup
# ═══════════════════════════════════════════════════════════════════════════════
step 18 "Cache warmup"
if [[ "${DEPLOY_SKIP_WARMUP:-0}" == "1" ]]; then
  warn "Skipping warmup (DEPLOY_SKIP_WARMUP=1)"
elif [[ -x "${SCRIPT_DIR}/warmup.sh" ]]; then
  "${SCRIPT_DIR}/warmup.sh" || warn "Cache warmup had issues (non-blocking)"
  ok "Cache warmup complete"
else
  warn "warmup.sh not found — skipping"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 19: CDN validation
# ═══════════════════════════════════════════════════════════════════════════════
step 19 "CDN validation"
if [[ "${DEPLOY_SKIP_CDN:-0}" == "1" ]]; then
  warn "Skipping CDN validation (DEPLOY_SKIP_CDN=1)"
elif [[ -x "${SCRIPT_DIR}/verify-cdn.sh" ]]; then
  "${SCRIPT_DIR}/verify-cdn.sh" || warn "CDN validation had issues (non-blocking)"
else
  warn "verify-cdn.sh not found — skipping"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 20: Caddy reload
# ═══════════════════════════════════════════════════════════════════════════════
step 20 "Caddy configuration"
if [[ -f "${RELEASE_DIR}/deploy/Caddyfile" ]]; then
  $SUDO cp "${RELEASE_DIR}/deploy/Caddyfile" /etc/caddy/Caddyfile
  $SUDO caddy fmt --overwrite /etc/caddy/Caddyfile 2>/dev/null || true
  if $SUDO caddy validate --config /etc/caddy/Caddyfile 2>/dev/null; then
    $SUDO systemctl reload caddy
    ok "Caddy reloaded with updated config"
  else
    warn "Caddy config validation failed — keeping previous config"
  fi
else
  warn "Caddyfile not found in release — skipping"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Write release metadata
# ═══════════════════════════════════════════════════════════════════════════════
DEPLOY_END=$(date +%s)
DEPLOY_DURATION=$((DEPLOY_END - DEPLOY_START))

RELEASE_META=$(cat <<ENDJSON
{"release":"${RELEASE_ID}","sha":"${TARGET_SHA}","sha7":"${SHA7}","ref":"${TARGET_REF}","status":"success","started":"${DEPLOY_START_ISO}","finished":"$(date -Iseconds)","duration_sec":${DEPLOY_DURATION},"deployer":"$(whoami)","hostname":"$(hostname)"}
ENDJSON
)

write_release_meta "$RELEASE_DIR" "$RELEASE_META"
ok "Release metadata written"

# ═══════════════════════════════════════════════════════════════════════════════
# Cleanup old releases
# ═══════════════════════════════════════════════════════════════════════════════
cleanup_old_releases "$RELEASE_RETENTION"
ok "Old releases cleaned up (keeping ${RELEASE_RETENTION})"

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║                    DEPLOY SUCCESSFUL                        ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Release:    ${BOLD}${RELEASE_ID}${RESET}"
echo -e "  SHA:        ${SHA7}"
echo -e "  Ref:        ${TARGET_REF}"
echo -e "  Duration:   ${DEPLOY_DURATION}s"
echo -e "  Log:        ${DEPLOY_LOG}"
echo ""
echo -e "  Services:"
for svc in mlaffon-api mlaffon-worker mlaffon-worker-fraud caddy; do
  if service_is_active "$svc"; then
    echo -e "    ${GREEN}●${RESET} ${svc}"
  else
    echo -e "    ${RED}○${RESET} ${svc}"
  fi
done
echo ""
