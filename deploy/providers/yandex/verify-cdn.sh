#!/usr/bin/env bash
# =============================================================================
# deploy/providers/yandex/verify-cdn.sh — Yandex Cloud CDN edge verification
#
# Provider-specific checks for Yandex CDN. Called by deploy/verify-cdn.sh.
# Expects common.sh to be already sourced and WEB_URL / ADMIN_URL to be set.
#
# Checks:
#   - Edge cache behavior via sequential requests
#   - Compression / Vary: Accept-Encoding safety
#   - Private API bypass (not cached on edge)
#   - X-Cache header if present
# =============================================================================

# This script is sourced or called with WEB_URL, ADMIN_URL, CDN_PASS, CDN_FAIL,
# CDN_WARN already in scope from the parent verify-cdn.sh.

echo -e "  ${BOLD}Yandex CDN edge checks:${RESET}"

# ── Compression / Vary safety ────────────────────────────────────────────────
# Critical: Yandex CDN caches gzip responses without Vary and serves to all clients.
# With --gzip-on enabled, CDN requests uncompressed from origin and compresses at edge.

echo ""
echo -e "  ${BOLD}Compression / Vary safety:${RESET}"

# Request WITH Accept-Encoding: gzip
VARY_VAL=$(curl -s -I --max-time 10 -H "Accept-Encoding: gzip" "${WEB_URL}/" 2>/dev/null \
  | grep -i "^vary:" | head -1 | tr -d '\r')

if echo "$VARY_VAL" | grep -qi "accept-encoding"; then
  ok "Vary: Accept-Encoding present (with gzip request)"
  CDN_PASS=$((CDN_PASS + 1))
else
  fail "Missing Vary: Accept-Encoding on gzip request — CDN may serve compressed content to all clients"
  CDN_FAIL=$((CDN_FAIL + 1))
fi

# Request WITHOUT Accept-Encoding — should NOT get Content-Encoding: gzip
NO_GZIP_CE=$(curl -s -I --max-time 10 --header "Accept-Encoding: identity" "${WEB_URL}/" 2>/dev/null \
  | grep -i "^content-encoding:" | head -1 | tr -d '\r')

if [[ -z "$NO_GZIP_CE" ]] || ! echo "$NO_GZIP_CE" | grep -qi "gzip"; then
  ok "No gzip served to non-gzip client (identity request)"
  CDN_PASS=$((CDN_PASS + 1))
else
  fail "Gzip served to non-gzip client — CDN compression misconfigured"
  CDN_FAIL=$((CDN_FAIL + 1))
fi

# ── Edge cache behavior ─────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Edge cache behavior:${RESET}"

# Check for X-Cache or similar header (Yandex CDN may add X-Cache: HIT/MISS)
if [[ -n "$ASSET_URL" ]]; then
  XCACHE=$(curl -s -I --max-time 10 "$ASSET_URL" 2>/dev/null \
    | grep -i "^x-cache:" | head -1 | sed 's/^[xX]-[cC]ache:[[:space:]]*//' | tr -d '\r')
  if [[ -n "$XCACHE" ]]; then
    ok "X-Cache header present: ${XCACHE}"
    CDN_PASS=$((CDN_PASS + 1))
  else
    warn "No X-Cache header on asset (Yandex CDN may not expose it — non-blocking)"
    CDN_WARN=$((CDN_WARN + 1))
  fi

  # Second request to same asset — should be fast (cached)
  T1=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "$ASSET_URL" 2>/dev/null || echo "99")
  T2=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "$ASSET_URL" 2>/dev/null || echo "99")
  # If second request is reasonably fast, cache is likely working
  T2_MS=$(echo "$T2 * 1000" | bc 2>/dev/null | cut -d. -f1 || echo "9999")
  if (( T2_MS < 2000 )); then
    ok "Asset response time: ${T2}s (cache likely working)"
    CDN_PASS=$((CDN_PASS + 1))
  else
    warn "Asset response time: ${T2}s (cache may still be warming — non-blocking)"
    CDN_WARN=$((CDN_WARN + 1))
  fi
fi

# ── Private API bypass verification ──────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Private API bypass:${RESET}"

# /api/v1/me should return 401 and NOT be cached
ME_STATUS_1=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${WEB_URL}/api/v1/me" 2>/dev/null || echo "000")
ME_CACHE_1=$(curl -s -I --max-time 10 "${WEB_URL}/api/v1/me" 2>/dev/null \
  | grep -i "^x-cache:" | head -1 | tr -d '\r')

if [[ "$ME_STATUS_1" == "401" ]]; then
  ok "Private API /me returns 401 (not publicly accessible)"
  CDN_PASS=$((CDN_PASS + 1))
else
  warn "Private API /me returned ${ME_STATUS_1} (expected 401)"
  CDN_WARN=$((CDN_WARN + 1))
fi

if echo "$ME_CACHE_1" | grep -qi "HIT"; then
  fail "Private API /me has X-Cache: HIT — should NOT be edge-cached"
  CDN_FAIL=$((CDN_FAIL + 1))
else
  ok "Private API /me is not edge-cached"
  CDN_PASS=$((CDN_PASS + 1))
fi

# /api/admin/stats should also not be cached
ADMIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${WEB_URL}/api/admin/stats" 2>/dev/null || echo "000")
if [[ "$ADMIN_STATUS" == "401" ]]; then
  ok "Admin API returns 401 (not publicly accessible)"
  CDN_PASS=$((CDN_PASS + 1))
else
  warn "Admin API returned ${ADMIN_STATUS} (expected 401)"
  CDN_WARN=$((CDN_WARN + 1))
fi
