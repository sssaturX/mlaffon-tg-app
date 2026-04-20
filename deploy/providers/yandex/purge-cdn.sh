#!/usr/bin/env bash
# =============================================================================
# deploy/providers/yandex/purge-cdn.sh — Yandex Cloud CDN cache purge
#
# Uses `yc cdn cache purge` to invalidate CDN cache.
#
# Usage (called by deploy/purge-cdn.sh):
#   providers/yandex/purge-cdn.sh /index.html /             # targeted purge
#   providers/yandex/purge-cdn.sh --all                      # full purge
#   providers/yandex/purge-cdn.sh --dry-run /index.html      # dry run
#
# Environment:
#   YC_CDN_RESOURCE_ID  (required) CDN resource ID
#   YC_FOLDER_ID        (optional) Yandex Cloud folder ID
#   YC_IAM_TOKEN        (optional) short-lived IAM token
#   YC_SA_KEY_FILE      (optional) path to SA key JSON
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

# ── Validate prerequisites ───────────────────────────────────────────────────
RESOURCE_ID="${YC_CDN_RESOURCE_ID:-}"
if [[ -z "$RESOURCE_ID" ]]; then
  if [[ -f "$SHARED_ENV" ]]; then
    RESOURCE_ID=$(read_env_val "$SHARED_ENV" "YC_CDN_RESOURCE_ID")
  fi
fi

if [[ -z "$RESOURCE_ID" ]]; then
  die "YC_CDN_RESOURCE_ID is not set. Set it in the environment or in ${SHARED_ENV}"
fi

if ! command -v yc &>/dev/null; then
  die "yc CLI not found. Install: https://cloud.yandex.ru/docs/cli/operations/install-cli"
fi

# ── Configure yc auth ────────────────────────────────────────────────────────
YC_AUTH_ARGS=()
if [[ -n "${YC_IAM_TOKEN:-}" ]]; then
  YC_AUTH_ARGS+=(--token "$YC_IAM_TOKEN")
elif [[ -n "${YC_SA_KEY_FILE:-}" && -f "${YC_SA_KEY_FILE}" ]]; then
  YC_AUTH_ARGS+=(--service-account-key "$YC_SA_KEY_FILE")
fi

if [[ -n "${YC_FOLDER_ID:-}" ]]; then
  YC_AUTH_ARGS+=(--folder-id "$YC_FOLDER_ID")
fi

# ── Build purge command ──────────────────────────────────────────────────────
PURGE_CMD=(yc cdn cache purge --resource-id "$RESOURCE_ID" "${YC_AUTH_ARGS[@]}")

if (( PURGE_ALL == 0 )); then
  if [[ ${#PATHS[@]} -eq 0 ]]; then
    die "No paths specified. Use --all for full purge or provide paths: purge-cdn.sh /index.html /"
  fi
  PURGE_CMD+=(--path "$(IFS=,; echo "${PATHS[*]}")")
fi

# ── Execute ──────────────────────────────────────────────────────────────────
if (( DRY_RUN )); then
  log "DRY RUN — would execute:"
  log "  ${PURGE_CMD[*]}"
  exit 0
fi

log "Purging Yandex CDN cache (resource: ${RESOURCE_ID})…"
if (( PURGE_ALL )); then
  log "Mode: full purge"
else
  log "Paths: ${PATHS[*]}"
fi

if "${PURGE_CMD[@]}" 2>&1; then
  ok "Cache purge request submitted"
  warn "Yandex CDN purge may take up to 15 minutes to propagate"
else
  err "Cache purge failed"
  err "Remediation:"
  err "  1. Check YC_CDN_RESOURCE_ID: ${RESOURCE_ID}"
  err "  2. Verify yc CLI auth: yc iam create-token"
  err "  3. Ensure SA has cdn.editor role"
  err "  4. Docs: docs/yandex-cdn.md"
  exit 1
fi
