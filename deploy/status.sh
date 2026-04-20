#!/usr/bin/env bash
# =============================================================================
# deploy/status.sh — show current deployment status, release info, service health
#
# Usage: ./deploy/status.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

echo ""
echo -e "${BOLD}mlaffon deployment status${RESET}"
echo -e "${BOLD}────────────────────────────────────────────${RESET}"
echo ""
echo -e "  CDN provider:      ${BOLD}${CDN_PROVIDER}${RESET}"
echo ""

# ── Current release ──────────────────────────────────────────────────────────
CUR="$(current_release)"
if [[ -n "$CUR" && -d "$CUR" ]]; then
  CUR_ID="$(release_id_from_path "$CUR")"
  echo -e "  Current release:   ${GREEN}${BOLD}${CUR_ID}${RESET}"
  if [[ -f "${CUR}/release.json" ]]; then
    echo -e "  Release metadata:"
    jq -r '  "    SHA:       \(.sha7 // .sha // "?")\n    Ref:       \(.ref // "?")\n    Status:    \(.status // "?")\n    Deployed:  \(.finished // .timestamp // "?")\n    Duration:  \(.duration_sec // "?")s\n    Deployer:  \(.deployer // "?")"' \
      "${CUR}/release.json" 2>/dev/null || echo "    (could not parse release.json)"
  fi
else
  echo -e "  Current release:   ${RED}none${RESET}"
fi

echo ""

# ── Previous release ─────────────────────────────────────────────────────────
PREV="$(previous_release)"
if [[ -n "$PREV" && -d "$PREV" ]]; then
  echo -e "  Previous release:  ${YELLOW}$(release_id_from_path "$PREV")${RESET}"
else
  echo -e "  Previous release:  none"
fi

echo ""

# ── Service status ───────────────────────────────────────────────────────────
echo -e "  ${BOLD}Services:${RESET}"
for svc in mlaffon-api mlaffon-worker mlaffon-worker-fraud caddy; do
  if service_is_active "$svc"; then
    echo -e "    ${GREEN}●${RESET} ${svc}  $(systemctl show "$svc" --property=ActiveEnterTimestamp --value 2>/dev/null || echo "")"
  elif systemctl list-unit-files "${svc}.service" &>/dev/null 2>&1; then
    echo -e "    ${RED}○${RESET} ${svc}  (inactive)"
  else
    echo -e "    ${YELLOW}-${RESET} ${svc}  (not installed)"
  fi
done

echo ""

# ── API health ───────────────────────────────────────────────────────────────
echo -e "  ${BOLD}API health:${RESET}"
HEALTH=$(curl -s --max-time 5 "${API_URL}/health/ready" 2>/dev/null || echo "")
if [[ -n "$HEALTH" ]]; then
  echo "    $HEALTH" | jq . 2>/dev/null || echo "    $HEALTH"
else
  echo -e "    ${RED}unreachable${RESET}"
fi

echo ""

VERSION=$(curl -s --max-time 5 "${API_URL}/version" 2>/dev/null || echo "")
if [[ -n "$VERSION" ]]; then
  echo -e "  ${BOLD}API version:${RESET}"
  echo "    $VERSION" | jq . 2>/dev/null || echo "    $VERSION"
  echo ""
fi

# ── Disk usage ───────────────────────────────────────────────────────────────
echo -e "  ${BOLD}Disk usage:${RESET}"
if [[ -d "$RELEASES_DIR" ]]; then
  RELEASE_COUNT=$(ls -d "$RELEASES_DIR"/*/ 2>/dev/null | wc -l)
  RELEASES_SIZE=$(du -sh "$RELEASES_DIR" 2>/dev/null | cut -f1)
  echo "    Releases:  ${RELEASE_COUNT} (${RELEASES_SIZE})"
fi
if [[ -d "$SHARED_BACKUPS" ]]; then
  BACKUP_COUNT=$(ls "$SHARED_BACKUPS"/*.dump 2>/dev/null | wc -l)
  BACKUPS_SIZE=$(du -sh "$SHARED_BACKUPS" 2>/dev/null | cut -f1)
  echo "    Backups:   ${BACKUP_COUNT} (${BACKUPS_SIZE})"
fi
DISK_FREE=$(df -h "$MLAFFON_BASE" 2>/dev/null | awk 'NR==2{print $4}')
echo "    Free disk: ${DISK_FREE:-unknown}"

echo ""

# ── Available releases ───────────────────────────────────────────────────────
echo -e "  ${BOLD}Available releases:${RESET}"
if [[ -d "$RELEASES_DIR" ]]; then
  for dir in $(ls -dt "$RELEASES_DIR"/*/ 2>/dev/null | head -10); do
    dir="${dir%/}"
    local_id="$(basename "$dir")"
    marker=""
    if [[ "$(readlink -f "$CURRENT_LINK" 2>/dev/null)" == "$(readlink -f "$dir")" ]]; then
      marker=" ${GREEN}← current${RESET}"
    elif [[ "$(readlink -f "$PREVIOUS_LINK" 2>/dev/null)" == "$(readlink -f "$dir")" ]]; then
      marker=" ${YELLOW}← previous${RESET}"
    fi
    echo -e "    ${local_id}${marker}"
  done
else
  echo "    (no releases directory)"
fi

echo ""

# ── Recent deploy history ───────────────────────────────────────────────────
if [[ -f "$DEPLOY_HISTORY" ]]; then
  echo -e "  ${BOLD}Recent deploys:${RESET}"
  tail -5 "$DEPLOY_HISTORY" | while IFS= read -r line; do
    echo "    $line" | jq -r '"    \(.timestamp // "?") | \(.action // "deploy") | \(.release // "?") | \(.status // "?")"' 2>/dev/null || echo "    $line"
  done
  echo ""
fi

# ── Deploy lock ──────────────────────────────────────────────────────────────
if [[ -f "${DEPLOY_LOCK}.pid" ]]; then
  LOCK_PID=$(cat "${DEPLOY_LOCK}.pid" 2>/dev/null || echo "?")
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo -e "  ${YELLOW}Deploy lock: held by PID ${LOCK_PID}${RESET}"
  else
    echo -e "  ${YELLOW}Deploy lock: stale (PID ${LOCK_PID} not running)${RESET}"
  fi
else
  echo -e "  Deploy lock: free"
fi

echo ""
