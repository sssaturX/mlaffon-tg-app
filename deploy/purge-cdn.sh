#!/usr/bin/env bash
# =============================================================================
# deploy/purge-cdn.sh — CDN cache purge dispatcher
#
# Delegates to the active CDN provider's purge implementation.
#
# Usage:
#   ./deploy/purge-cdn.sh /index.html /           # purge specific paths
#   ./deploy/purge-cdn.sh --all                    # full cache purge
#   ./deploy/purge-cdn.sh --dry-run /index.html    # preview without purging
#
# Supports CDN_PROVIDER: yandex | cloudflare | none
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

if [[ "${CDN_PROVIDER}" == "none" ]]; then
  warn "CDN_PROVIDER=none — no CDN to purge"
  exit 0
fi

PROVIDER_PURGE="$(resolve_cdn_script "purge-cdn.sh")"
if [[ -z "$PROVIDER_PURGE" ]]; then
  die "No purge script found for CDN_PROVIDER=${CDN_PROVIDER}. Check deploy/providers/${CDN_PROVIDER}/purge-cdn.sh"
fi

log "CDN purge (provider: ${CDN_PROVIDER})"
exec "$PROVIDER_PURGE" "$@"
