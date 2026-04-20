#!/usr/bin/env bash
# =============================================================================
# deploy/redeploy.sh — DEPRECATED legacy wrapper
#
# This script is kept for backward compatibility during the transition period.
# It delegates to the new deploy/release.sh pipeline.
#
# Use deploy/release.sh directly for new deployments:
#   ./deploy/release.sh              # deploy latest main
#   ./deploy/release.sh v1.2.3       # deploy a tag
#   ./deploy/release.sh --dry-run    # preflight only
#
# See docs/deploy-pipeline.md for full documentation.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  WARNING: redeploy.sh is DEPRECATED                                ║"
echo "║                                                                    ║"
echo "║  This script now delegates to deploy/release.sh                    ║"
echo "║  Please migrate to the new pipeline:                               ║"
echo "║    ./deploy/release.sh              # deploy latest main           ║"
echo "║    ./deploy/release.sh v1.2.3       # deploy a tag                ║"
echo "║    ./deploy/release.sh --dry-run    # preflight only              ║"
echo "║    ./deploy/rollback.sh             # rollback to previous        ║"
echo "║    ./deploy/status.sh               # show deployment status      ║"
echo "║                                                                    ║"
echo "║  See docs/deploy-pipeline.md for full documentation.               ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Continuing in 5 seconds… (Ctrl+C to abort)"
sleep 5

exec "${SCRIPT_DIR}/release.sh" "${@:-main}"
