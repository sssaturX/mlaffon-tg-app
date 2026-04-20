#!/usr/bin/env bash
# =============================================================================
# Basic load test using curl (no external tools required)
# For production-grade load testing, install autocannon: npm i -g autocannon
# Usage:
#   ./deploy/load-test.sh [BASE_URL] [RPS] [DURATION_SEC]
# =============================================================================
set -euo pipefail

BASE="${1:-http://localhost:3001}"
TARGET_RPS="${2:-50}"
DURATION="${3:-10}"

ENDPOINTS=(
  "/api/v1/home/public"
  "/api/v1/home/content"
  "/api/v1/home/giveaways"
  "/health"
)

HAS_AUTOCANNON=0
if command -v autocannon &>/dev/null; then
  HAS_AUTOCANNON=1
fi

echo ""
echo "=== Load Test: ${BASE} ==="
echo "Target: ~${TARGET_RPS} RPS for ${DURATION}s per endpoint"
echo "Tool: $([ "$HAS_AUTOCANNON" -eq 1 ] && echo "autocannon" || echo "curl (basic)")"
echo ""

if [ "$HAS_AUTOCANNON" -eq 1 ]; then
  for ep in "${ENDPOINTS[@]}"; do
    echo "--- ${ep} ---"
    autocannon \
      -c "$TARGET_RPS" \
      -d "$DURATION" \
      -p 1 \
      --renderStatusCodes \
      "${BASE}${ep}"
    echo ""
  done
else
  for ep in "${ENDPOINTS[@]}"; do
    echo "--- ${ep} ---"
    TOTAL=0
    ERRORS=0
    START=$(date +%s)
    END=$((START + DURATION))

    while [ "$(date +%s)" -lt "$END" ]; do
      for _ in $(seq 1 "$TARGET_RPS"); do
        status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}${ep}" 2>/dev/null || echo "000")
        TOTAL=$((TOTAL + 1))
        if [ "$status" != "200" ]; then
          ERRORS=$((ERRORS + 1))
        fi
      done &
      sleep 1
    done
    wait

    ELAPSED=$(( $(date +%s) - START ))
    RPS=$((TOTAL / (ELAPSED > 0 ? ELAPSED : 1)))
    echo "  Requests: ${TOTAL} | Errors: ${ERRORS} | Duration: ${ELAPSED}s | ~${RPS} RPS"
    if [ "$ERRORS" -gt 0 ]; then
      ERROR_PCT=$((ERRORS * 100 / TOTAL))
      echo "  Error rate: ${ERROR_PCT}%"
      if [ "$ERROR_PCT" -gt 5 ]; then
        echo "  WARNING: Error rate exceeds 5%"
      fi
    else
      echo "  Error rate: 0%"
    fi
    echo ""
  done
fi

echo "=== Load Test Complete ==="
