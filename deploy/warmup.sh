#!/usr/bin/env bash
# =============================================================================
# deploy/warmup.sh — post-deploy cache warmup
# Hits public endpoints to prime Redis caches and CDN edge caches.
#
# Usage: ./deploy/warmup.sh [BASE_URL]
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

BASE="${1:-${API_URL}}"
WARMUP_PASS=0
WARMUP_FAIL=0

warm() {
  local name="$1" url="$2" attempts="${3:-2}"
  local i=1
  while (( i <= attempts )); do
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
    if [[ "$status" == "200" ]]; then
      if (( i == attempts )); then
        ok "${name} — warmed (${attempts} hits)"
        WARMUP_PASS=$((WARMUP_PASS + 1))
      fi
    else
      if (( i == attempts )); then
        warn "${name} — got ${status}"
        WARMUP_FAIL=$((WARMUP_FAIL + 1))
      fi
    fi
    i=$((i + 1))
    sleep 0.2
  done
}

echo ""
log "Cache warmup: ${BASE}"
echo ""

warm "Home public"     "${BASE}/api/v1/home/public"     2
warm "Home content"    "${BASE}/api/v1/home/content"     2
warm "Home giveaways"  "${BASE}/api/v1/home/giveaways"   2
warm "Leaderboard"     "${BASE}/api/v1/leaderboard"      2
warm "Health"          "${BASE}/health"                   1

echo ""
if (( WARMUP_FAIL > 0 )); then
  warn "Warmup: ${WARMUP_PASS} OK, ${WARMUP_FAIL} issues"
  exit 1
else
  log "Warmup complete: ${WARMUP_PASS} endpoints primed"
fi
