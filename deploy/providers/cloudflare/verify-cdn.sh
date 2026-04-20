#!/usr/bin/env bash
# =============================================================================
# deploy/providers/cloudflare/verify-cdn.sh — Cloudflare-specific edge checks
#
# Called by deploy/verify-cdn.sh. Expects common.sh sourced, WEB_URL/ADMIN_URL,
# CDN_PASS/CDN_FAIL/CDN_WARN, and ASSET_URL in scope.
# =============================================================================

echo -e "  ${BOLD}Cloudflare edge checks:${RESET}"

check_cf_cache() {
  local name="$1" url="$2" expected_pattern="$3"
  local val
  val=$(curl -s -I --max-time 10 "$url" 2>/dev/null | grep -i "^cf-cache-status:" | head -1 | sed 's/^cf-cache-status:[[:space:]]*//' | tr -d '\r')
  if [[ -z "$val" ]]; then
    warn "${name}: no cf-cache-status (not behind Cloudflare?)"
    CDN_WARN=$((CDN_WARN + 1))
    return
  fi
  if echo "$val" | grep -qiE "$expected_pattern"; then
    ok "${name}: cf-cache-status=${val}"
    CDN_PASS=$((CDN_PASS + 1))
  else
    warn "${name}: cf-cache-status=${val} (expected pattern: ${expected_pattern})"
    CDN_WARN=$((CDN_WARN + 1))
  fi
}

if [[ -n "${ASSET_URL:-}" ]]; then
  check_cf_cache "JS asset" "$ASSET_URL" "HIT|MISS|EXPIRED|REVALIDATED"
fi

check_cf_cache "index.html" "${WEB_URL}/" "DYNAMIC|HIT|MISS|EXPIRED|REVALIDATED"
