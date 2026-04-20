#!/usr/bin/env bash
# =============================================================================
# deploy/verify-cdn.sh — CDN verification dispatcher
#
# Runs universal origin-level header checks, then delegates to the active
# CDN provider for provider-specific edge verification.
#
# Usage:
#   ./deploy/verify-cdn.sh                  # check headers only
#   ./deploy/verify-cdn.sh --purge          # check + purge index.html
#   ./deploy/verify-cdn.sh --purge-all      # check + purge everything
#
# Supports CDN_PROVIDER: yandex | cloudflare | none
#
# Environment:
#   CDN_PROVIDER       (from shared env or env var; defaults to none)
#   PUBLIC_WEB_URL     (required for CDN checks)
#   PUBLIC_ADMIN_URL   (optional)
#   Provider-specific vars: see deploy/providers/{provider}/
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

PURGE_MODE="none"
if [[ "${1:-}" == "--purge" ]]; then PURGE_MODE="selective"; fi
if [[ "${1:-}" == "--purge-all" ]]; then PURGE_MODE="all"; fi

CDN_PASS=0
CDN_FAIL=0
CDN_WARN=0

# ── Resolve URLs ─────────────────────────────────────────────────────────────
WEB_URL="${PUBLIC_WEB_URL:-}"
ADMIN_URL="${PUBLIC_ADMIN_URL:-}"

if [[ -z "$WEB_URL" && -f "$SHARED_ENV" ]]; then
  WEB_URL=$(read_env_val "$SHARED_ENV" "PUBLIC_WEB_URL")
fi
if [[ -z "$ADMIN_URL" && -f "$SHARED_ENV" ]]; then
  ADMIN_URL=$(read_env_val "$SHARED_ENV" "PUBLIC_ADMIN_URL")
fi

if [[ -z "$WEB_URL" ]]; then
  warn "PUBLIC_WEB_URL not set — skipping CDN validation"
  exit 0
fi

# ── Header check helper ─────────────────────────────────────────────────────
check_header() {
  local name="$1" url="$2" header="$3" pattern="$4"
  local val
  val=$(curl -s -I --max-time 10 "$url" 2>/dev/null | grep -i "^${header}:" | head -1 | sed "s/^${header}:[[:space:]]*//" | tr -d '\r')
  if [[ -z "$val" ]]; then
    fail "${name}: missing ${header} header"
    CDN_FAIL=$((CDN_FAIL + 1))
    return
  fi
  if echo "$val" | grep -qiE "$pattern"; then
    ok "${name}: ${header}=${val}"
    CDN_PASS=$((CDN_PASS + 1))
  else
    fail "${name}: ${header}=${val} (expected: ${pattern})"
    CDN_FAIL=$((CDN_FAIL + 1))
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Universal checks (provider-agnostic origin header validation)
# ══════════════════════════════════════════════════════════════════════════════
echo ""
log "CDN validation: ${WEB_URL} (provider: ${CDN_PROVIDER})"
echo ""

# ── Static assets ────────────────────────────────────────────────────────────
echo -e "  ${BOLD}Static assets (/assets/*):${RESET}"
ASSET_URL=""
INDEX_HTML=$(curl -s --max-time 10 "${WEB_URL}/" 2>/dev/null || echo "")
if [[ -n "$INDEX_HTML" ]]; then
  ASSET_URL=$(echo "$INDEX_HTML" | grep -oP 'src="/assets/[^"]+' | head -1 | sed 's/src="//')
  if [[ -n "$ASSET_URL" ]]; then
    ASSET_URL="${WEB_URL}${ASSET_URL}"
  fi
fi

if [[ -n "$ASSET_URL" ]]; then
  check_header "JS asset" "$ASSET_URL" "cache-control" "immutable"
else
  warn "Could not find a JS asset URL to test"
  CDN_WARN=$((CDN_WARN + 1))
fi

# ── HTML ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}HTML (index.html):${RESET}"
check_header "index.html" "${WEB_URL}/" "cache-control" "max-age=(0|60)"

# ── Public API ───────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Public API:${RESET}"
check_header "API /home/public" "${WEB_URL}/api/v1/home/public" "cache-control" "public"

# ── Security headers ─────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Security headers:${RESET}"
check_header "HSTS" "${WEB_URL}/" "strict-transport-security" "max-age="
check_header "X-Content-Type-Options" "${WEB_URL}/" "x-content-type-options" "nosniff"

if [[ -n "$ADMIN_URL" ]]; then
  echo ""
  echo -e "  ${BOLD}Admin panel:${RESET}"
  check_header "Admin X-Frame-Options" "${ADMIN_URL}/" "x-frame-options" "DENY"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Provider-specific checks
# ══════════════════════════════════════════════════════════════════════════════
PROVIDER_VERIFY="$(resolve_cdn_script "verify-cdn.sh")"
if [[ -n "$PROVIDER_VERIFY" ]]; then
  echo ""
  # Source provider script — it uses CDN_PASS/CDN_FAIL/CDN_WARN/WEB_URL/ADMIN_URL/ASSET_URL
  source "$PROVIDER_VERIFY"
elif [[ "$CDN_PROVIDER" != "none" ]]; then
  echo ""
  warn "No verify script found for provider '${CDN_PROVIDER}' — skipping provider checks"
else
  echo ""
  log "CDN_PROVIDER=none — skipping provider-specific edge checks"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Purge (delegated to provider)
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$PURGE_MODE" != "none" ]]; then
  echo ""
  echo -e "  ${BOLD}Cache purge:${RESET}"
  PROVIDER_PURGE="$(resolve_cdn_script "purge-cdn.sh")"
  if [[ -n "$PROVIDER_PURGE" ]]; then
    PURGE_ARGS=()
    if [[ "$PURGE_MODE" == "all" ]]; then
      PURGE_ARGS+=(--all)
    else
      PURGE_ARGS+=(/index.html /)
      if [[ -n "$ADMIN_URL" ]]; then
        # Admin purge is handled inside the provider script for CF;
        # for Yandex, paths are CDN-resource-relative so /index.html covers both
        true
      fi
    fi
    "$PROVIDER_PURGE" "${PURGE_ARGS[@]}" || warn "Purge had issues (see output above)"
  elif [[ "$CDN_PROVIDER" != "none" ]]; then
    warn "No purge script found for provider '${CDN_PROVIDER}'"
  else
    log "CDN_PROVIDER=none — purge skipped"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if (( CDN_FAIL > 0 )); then
  err "CDN validation: ${CDN_PASS} passed, ${CDN_FAIL} failed, ${CDN_WARN} warnings"
  exit 1
elif (( CDN_WARN > 0 )); then
  warn "CDN validation: ${CDN_PASS} passed, ${CDN_WARN} warnings"
else
  log "CDN validation: ${CDN_PASS} checks passed"
fi
