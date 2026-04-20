#!/usr/bin/env bash
# =============================================================================
# deploy/providers/cloudflare/purge-cdn.sh — Cloudflare cache purge via API
#
# Usage (called by deploy/purge-cdn.sh):
#   providers/cloudflare/purge-cdn.sh /index.html /           # targeted purge
#   providers/cloudflare/purge-cdn.sh --all                    # full purge
#   providers/cloudflare/purge-cdn.sh --dry-run /index.html    # dry run
#
# Environment:
#   CF_ZONE_ID    (required)
#   CF_API_TOKEN  (required)
#   PUBLIC_WEB_URL   (required for targeted purge URL construction)
#   PUBLIC_ADMIN_URL (optional)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../common.sh
source "${SCRIPT_DIR}/../../common.sh"

DRY_RUN=0
PURGE_ALL=0
PATHS=()

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --all)     PURGE_ALL=1 ;;
    *)         PATHS+=("$arg") ;;
  esac
done

# ── Resolve credentials ─────────────────────────────────────────────────────
CF_ZONE="${CF_ZONE_ID:-}"
CF_TOKEN="${CF_API_TOKEN:-}"

if [[ -z "$CF_ZONE" && -f "$SHARED_ENV" ]]; then
  CF_ZONE=$(read_env_val "$SHARED_ENV" "CF_ZONE_ID")
fi
if [[ -z "$CF_TOKEN" && -f "$SHARED_ENV" ]]; then
  CF_TOKEN=$(read_env_val "$SHARED_ENV" "CF_API_TOKEN")
fi

if [[ -z "$CF_ZONE" || -z "$CF_TOKEN" ]]; then
  die "CF_ZONE_ID and CF_API_TOKEN required for Cloudflare purge"
fi

# ── Resolve URLs ─────────────────────────────────────────────────────────────
WEB_URL="${PUBLIC_WEB_URL:-}"
ADMIN_URL="${PUBLIC_ADMIN_URL:-}"
if [[ -z "$WEB_URL" && -f "$SHARED_ENV" ]]; then
  WEB_URL=$(read_env_val "$SHARED_ENV" "PUBLIC_WEB_URL")
fi
if [[ -z "$ADMIN_URL" && -f "$SHARED_ENV" ]]; then
  ADMIN_URL=$(read_env_val "$SHARED_ENV" "PUBLIC_ADMIN_URL")
fi

# ── Execute purge ────────────────────────────────────────────────────────────
if (( PURGE_ALL )); then
  if (( DRY_RUN )); then
    log "DRY RUN — would purge ALL cache for zone ${CF_ZONE}"
    exit 0
  fi
  log "Purging all Cloudflare cache for zone ${CF_ZONE}…"
  RESP=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' 2>/dev/null)
else
  if [[ ${#PATHS[@]} -eq 0 ]]; then
    die "No paths specified. Use --all for full purge or provide paths."
  fi

  # Build URL list from paths
  PURGE_URLS="["
  FIRST=1
  for p in "${PATHS[@]}"; do
    if [[ -n "$WEB_URL" ]]; then
      [[ $FIRST -eq 1 ]] || PURGE_URLS="${PURGE_URLS},"
      PURGE_URLS="${PURGE_URLS}\"${WEB_URL}${p}\""
      FIRST=0
    fi
    if [[ -n "$ADMIN_URL" ]]; then
      PURGE_URLS="${PURGE_URLS},\"${ADMIN_URL}${p}\""
    fi
  done
  PURGE_URLS="${PURGE_URLS}]"

  if (( DRY_RUN )); then
    log "DRY RUN — would purge: ${PURGE_URLS}"
    exit 0
  fi

  log "Purging Cloudflare cache: ${PURGE_URLS}"
  RESP=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"files\":${PURGE_URLS}}" 2>/dev/null)
fi

if echo "$RESP" | jq -e '.success == true' &>/dev/null; then
  ok "Cloudflare cache purge successful"
else
  err "Cache purge failed: $(echo "$RESP" | jq -c '.errors // .' 2>/dev/null)"
  exit 1
fi
