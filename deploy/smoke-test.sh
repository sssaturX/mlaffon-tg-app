#!/usr/bin/env bash
# =============================================================================
# Post-deploy smoke test — verifies critical endpoints after deployment
# Usage:
#   ./deploy/smoke-test.sh [BASE_URL]          # human-readable output
#   ./deploy/smoke-test.sh [BASE_URL] --json   # JSON output for pipeline
# =============================================================================
set -euo pipefail

BASE="${1:-http://localhost:3001}"
JSON_MODE=0

for arg in "$@"; do
  if [[ "$arg" == "--json" ]]; then JSON_MODE=1; fi
done

PASS=0
FAIL=0
JSON_RESULTS="["

_add_json() {
  local name="$1" status="$2" expected="$3" actual="$4"
  local passed="true"
  [[ "$status" == "pass" ]] || passed="false"
  if [[ "$JSON_RESULTS" != "[" ]]; then JSON_RESULTS="${JSON_RESULTS},"; fi
  JSON_RESULTS="${JSON_RESULTS}{\"name\":\"${name}\",\"passed\":${passed},\"expected\":\"${expected}\",\"actual\":\"${actual}\"}"
}

check() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")

  if [ "$status" = "$expected_status" ]; then
    (( JSON_MODE )) || echo "  ✓ $name ($status)"
    PASS=$((PASS + 1))
    _add_json "$name" "pass" "$expected_status" "$status"
  else
    (( JSON_MODE )) || echo "  ✗ $name (got $status, expected $expected_status)"
    FAIL=$((FAIL + 1))
    _add_json "$name" "fail" "$expected_status" "$status"
  fi
}

check_json() {
  local name="$1"
  local url="$2"
  local key="$3"

  local body
  body=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "{}")
  local val
  val=$(echo "$body" | grep -o "\"$key\"" | head -1)

  if [ -n "$val" ]; then
    (( JSON_MODE )) || echo "  ✓ $name (key '$key' present)"
    PASS=$((PASS + 1))
    _add_json "$name" "pass" "key:${key}" "present"
  else
    (( JSON_MODE )) || echo "  ✗ $name (key '$key' missing in response)"
    FAIL=$((FAIL + 1))
    _add_json "$name" "fail" "key:${key}" "missing"
  fi
}

(( JSON_MODE )) || echo ""
(( JSON_MODE )) || echo "=== Smoke Test: $BASE ==="
(( JSON_MODE )) || echo ""

(( JSON_MODE )) || echo "--- Health ---"
check "Liveness" "$BASE/health"
check_json "Liveness body" "$BASE/health" "ok"
check "Readiness" "$BASE/health/ready"

(( JSON_MODE )) || echo ""
(( JSON_MODE )) || echo "--- Public API ---"
check "Home public" "$BASE/api/v1/home/public"
check "Home content" "$BASE/api/v1/home/content"
check "Home giveaways" "$BASE/api/v1/home/giveaways"

(( JSON_MODE )) || echo ""
(( JSON_MODE )) || echo "--- Auth boundary ---"
check "Unauthenticated /me" "$BASE/api/v1/me" "401"
check "Unauthenticated admin" "$BASE/api/admin/stats" "401"

(( JSON_MODE )) || echo ""
(( JSON_MODE )) || echo "--- Version ---"
check "Version endpoint" "$BASE/version"
check_json "Version has commit" "$BASE/version" "commit"

(( JSON_MODE )) || echo ""
(( JSON_MODE )) || echo "--- Metrics ---"
check "Metrics endpoint" "$BASE/metrics"

(( JSON_MODE )) || echo ""
(( JSON_MODE )) || echo "--- Cache headers ---"
CACHE_HEADER=$(curl -s -I --max-time 10 "$BASE/api/v1/home/public" 2>/dev/null | grep -i "cache-control" | head -1)
if echo "$CACHE_HEADER" | grep -qi "public"; then
  (( JSON_MODE )) || echo "  ✓ Public cache header on /home/public"
  PASS=$((PASS + 1))
  _add_json "Cache-Control public" "pass" "public" "present"
else
  (( JSON_MODE )) || echo "  ✗ Missing public cache header on /home/public"
  FAIL=$((FAIL + 1))
  _add_json "Cache-Control public" "fail" "public" "missing"
fi

PRIVATE_HEADER=$(curl -s -I --max-time 10 -H "Authorization: Bearer fake" "$BASE/api/v1/me" 2>/dev/null | grep -i "cache-control" | head -1)
if echo "$PRIVATE_HEADER" | grep -qi "private\|no-store"; then
  (( JSON_MODE )) || echo "  ✓ Private/no-store on /me"
  PASS=$((PASS + 1))
  _add_json "Cache-Control private" "pass" "private|no-store" "present"
else
  (( JSON_MODE )) || echo "  ✗ Missing private cache header on /me (got: ${PRIVATE_HEADER})"
  FAIL=$((FAIL + 1))
  _add_json "Cache-Control private" "fail" "private|no-store" "missing"
fi

(( JSON_MODE )) || echo ""
(( JSON_MODE )) || echo "--- WebSocket ---"
WS_BASE="${BASE/http/ws}"
WS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "$BASE/api/v1/ws" 2>/dev/null || echo "000")
if [ "$WS_STATUS" = "101" ] || [ "$WS_STATUS" = "400" ] || [ "$WS_STATUS" = "401" ]; then
  (( JSON_MODE )) || echo "  ✓ WebSocket endpoint reachable ($WS_STATUS)"
  PASS=$((PASS + 1))
  _add_json "WebSocket" "pass" "101|400|401" "$WS_STATUS"
else
  (( JSON_MODE )) || echo "  ✗ WebSocket endpoint unreachable ($WS_STATUS)"
  FAIL=$((FAIL + 1))
  _add_json "WebSocket" "fail" "101|400|401" "$WS_STATUS"
fi

(( JSON_MODE )) || echo ""
(( JSON_MODE )) || echo "--- CORS ---"
CORS_RESP=$(curl -s -I --max-time 5 \
  -H "Origin: https://evil.example.com" \
  "$BASE/api/v1/home/public" 2>/dev/null | grep -i "access-control-allow-origin" | head -1)
if echo "$CORS_RESP" | grep -qi "evil.example.com"; then
  (( JSON_MODE )) || echo "  ✗ CORS reflects arbitrary origin (SECURITY ISSUE)"
  FAIL=$((FAIL + 1))
  _add_json "CORS security" "fail" "no-reflect" "reflects"
else
  (( JSON_MODE )) || echo "  ✓ CORS does not reflect arbitrary origin"
  PASS=$((PASS + 1))
  _add_json "CORS security" "pass" "no-reflect" "ok"
fi

JSON_RESULTS="${JSON_RESULTS}]"

if (( JSON_MODE )); then
  cat <<ENDJSON
{"base":"${BASE}","pass":${PASS},"fail":${FAIL},"success":$([ "$FAIL" -eq 0 ] && echo true || echo false),"results":${JSON_RESULTS}}
ENDJSON
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "⚠ SMOKE TEST FAILED — review failures before proceeding"
  exit 1
fi

echo "✓ All smoke tests passed"
exit 0
