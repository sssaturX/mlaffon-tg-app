#!/usr/bin/env bash
# =============================================================================
# deploy/verify-release.sh — combined post-deploy verification gate
# Runs health, smoke, CDN, and version checks as a single pass/fail gate.
#
# Usage: ./deploy/verify-release.sh [BASE_URL] [EXPECTED_SHA7]
# Exit 0 = all critical checks passed, exit 1 = failure
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

BASE="${1:-${API_URL}}"
EXPECTED_SHA="${2:-}"
GATE_PASS=0
GATE_FAIL=0

gate_check() {
  local name="$1" result="$2"
  if [[ "$result" == "0" ]]; then
    ok "${name}"
    GATE_PASS=$((GATE_PASS + 1))
  else
    fail "${name}"
    GATE_FAIL=$((GATE_FAIL + 1))
  fi
}

echo ""
echo -e "${BOLD}Post-deploy verification gate${RESET}"
echo -e "${BOLD}────────────────────────────────────────────${RESET}"
echo ""

# ── 1. Health ────────────────────────────────────────────────────────────────
echo -e "  ${BOLD}Health:${RESET}"
HEALTH_OK=1
if curl -sf --max-time 5 "${BASE}/health" &>/dev/null; then HEALTH_OK=0; fi
gate_check "Liveness /health" "$HEALTH_OK"

READY_OK=1
if curl -sf --max-time 5 "${BASE}/health/ready" &>/dev/null; then READY_OK=0; fi
gate_check "Readiness /health/ready" "$READY_OK"

# ── 2. Version ───────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Version:${RESET}"
VERSION_BODY=$(curl -s --max-time 5 "${BASE}/version" 2>/dev/null || echo "")
if [[ -n "$VERSION_BODY" ]]; then
  LIVE_SHA=$(echo "$VERSION_BODY" | jq -r '.commit // empty' 2>/dev/null || echo "")
  if [[ -n "$EXPECTED_SHA" ]]; then
    if [[ "$LIVE_SHA" == "$EXPECTED_SHA" ]]; then
      gate_check "Version matches (${LIVE_SHA})" "0"
    else
      gate_check "Version mismatch (got=${LIVE_SHA}, want=${EXPECTED_SHA})" "1"
    fi
  else
    gate_check "Version endpoint responding (${LIVE_SHA:-?})" "0"
  fi
else
  gate_check "/version unreachable" "1"
fi

# ── 3. Smoke tests ──────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Smoke tests:${RESET}"
if [[ -x "${SCRIPT_DIR}/smoke-test.sh" ]]; then
  SMOKE_OK=1
  if "${SCRIPT_DIR}/smoke-test.sh" "${BASE}" &>/dev/null; then SMOKE_OK=0; fi
  gate_check "Smoke test suite" "$SMOKE_OK"
else
  warn "smoke-test.sh not found — skipping"
fi

# ── 4. CDN (non-blocking) ───────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}CDN (informational):${RESET}"
if [[ -x "${SCRIPT_DIR}/verify-cdn.sh" ]]; then
  if "${SCRIPT_DIR}/verify-cdn.sh" &>/dev/null; then
    ok "CDN validation passed"
  else
    warn "CDN validation had issues (non-blocking)"
  fi
else
  warn "verify-cdn.sh not found — skipping CDN checks"
fi

# ── Result ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}────────────────────────────────────────────${RESET}"
if (( GATE_FAIL > 0 )); then
  err "VERIFICATION FAILED: ${GATE_PASS} passed, ${GATE_FAIL} failed"
  exit 1
fi

echo -e "${GREEN}${BOLD}VERIFICATION PASSED: ${GATE_PASS} checks OK${RESET}"
echo ""
