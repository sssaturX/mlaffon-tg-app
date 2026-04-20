#!/usr/bin/env bash
# =============================================================================
# deploy/rollback.sh — standalone rollback to previous (or explicit) release
#
# Usage:
#   ./deploy/rollback.sh                        # rollback to previous release
#   ./deploy/rollback.sh 20260420_143022_abc1234 # rollback to specific release
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

TARGET="${1:-}"

echo ""
echo -e "${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${YELLOW}║                     ROLLBACK                                ║${RESET}"
echo -e "${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Resolve target release ───────────────────────────────────────────────────
if [[ -n "$TARGET" ]]; then
  TARGET_DIR="${RELEASES_DIR}/${TARGET}"
  if [[ ! -d "$TARGET_DIR" ]]; then
    die "Release not found: ${TARGET_DIR}"
  fi
  log "Rolling back to explicit release: ${TARGET}"
else
  TARGET_DIR="$(previous_release)"
  if [[ -z "$TARGET_DIR" || ! -d "$TARGET_DIR" ]]; then
    die "No previous release available. Specify a release ID manually."
  fi
  TARGET="$(release_id_from_path "$TARGET_DIR")"
  log "Rolling back to previous release: ${TARGET}"
fi

# ── Show what's changing ─────────────────────────────────────────────────────
CUR="$(current_release)"
if [[ -n "$CUR" ]]; then
  log "Current release:  $(release_id_from_path "$CUR")"
fi
log "Rollback target:  ${TARGET}"
echo ""

# ── Acquire lock ─────────────────────────────────────────────────────────────
acquire_lock
trap release_lock EXIT

# ── Switch symlink ───────────────────────────────────────────────────────────
step 1 "Switch symlink"

# Save current as previous (so we can "rollback the rollback")
if [[ -n "$CUR" && -d "$CUR" ]]; then
  ln -sfn "$CUR" "$PREVIOUS_LINK"
  ok "Saved current as previous: $(release_id_from_path "$CUR")"
fi

ln -sfn "$TARGET_DIR" "$CURRENT_LINK"
ok "Switched: current → ${TARGET}"

# ── Reinstall systemd units from target release ─────────────────────────────
step 2 "Reinstall systemd units"
for unit in mlaffon-api.service mlaffon-worker.service mlaffon-worker-fraud.service; do
  if [[ -f "${TARGET_DIR}/deploy/${unit}" ]]; then
    $SUDO cp "${TARGET_DIR}/deploy/${unit}" "/etc/systemd/system/${unit}"
    ok "Installed: ${unit}"
  fi
done
$SUDO systemctl daemon-reload

# ── Restart services ─────────────────────────────────────────────────────────
step 3 "Restart services"
restart_service mlaffon-api
restart_service mlaffon-worker
if systemctl list-unit-files mlaffon-worker-fraud.service &>/dev/null; then
  restart_service mlaffon-worker-fraud
fi

# ── Health verification ──────────────────────────────────────────────────────
step 4 "Health verification"
log "Waiting for API readiness…"
if wait_http "${API_URL}/health/ready" 30 2; then
  ok "API is healthy"
else
  err "API health check failed after rollback!"
  err "Manual intervention required:"
  err "  1. journalctl -u mlaffon-api -n 50"
  err "  2. systemctl restart mlaffon-api"
  err "  3. Check ${SHARED_ENV} for configuration issues"
  exit 1
fi

# ── Smoke test ───────────────────────────────────────────────────────────────
step 5 "Quick smoke test"
if [[ -x "${SCRIPT_DIR}/smoke-test.sh" ]]; then
  if "${SCRIPT_DIR}/smoke-test.sh" "${API_URL}"; then
    ok "Smoke tests passed"
  else
    warn "Smoke tests had failures — check output above"
  fi
fi

# ── Metadata ─────────────────────────────────────────────────────────────────
write_release_meta "$TARGET_DIR" "$(cat <<ENDJSON
{"release":"${TARGET}","action":"rollback","timestamp":"$(date -Iseconds)","deployer":"$(whoami)","from":"$(release_id_from_path "${CUR:-unknown}")"}
ENDJSON
)"

# ── Caddy reload ─────────────────────────────────────────────────────────────
if [[ -f "${TARGET_DIR}/deploy/Caddyfile" ]]; then
  $SUDO cp "${TARGET_DIR}/deploy/Caddyfile" /etc/caddy/Caddyfile
  $SUDO caddy fmt --overwrite /etc/caddy/Caddyfile 2>/dev/null || true
  if $SUDO caddy validate --config /etc/caddy/Caddyfile 2>/dev/null; then
    $SUDO systemctl reload caddy
    ok "Caddy reloaded"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Rollback complete → ${TARGET}${RESET}"
echo ""
for svc in mlaffon-api mlaffon-worker mlaffon-worker-fraud caddy; do
  if service_is_active "$svc"; then
    echo -e "  ${GREEN}●${RESET} ${svc}"
  else
    echo -e "  ${RED}○${RESET} ${svc}"
  fi
done
echo ""
