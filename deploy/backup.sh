#!/usr/bin/env bash
# =============================================================================
# PostgreSQL automated backup
# Usage:
#   ./deploy/backup.sh                           # manual backup
#   ./deploy/backup.sh --pre-deploy abc1234      # pre-deploy backup tagged with SHA
#   Add to crontab for automated daily backups:
#   0 2 * * * /opt/mlaffon/current/deploy/backup.sh >> /var/log/mlaffon-backup.log 2>&1
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/mlaffon/shared/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

PRE_DEPLOY=0
DEPLOY_SHA=""

if [[ "${1:-}" == "--pre-deploy" ]]; then
  PRE_DEPLOY=1
  DEPLOY_SHA="${2:-unknown}"
  shift 2 || true
fi

# ── Resolve DATABASE_URL ────────────────────────────────────────────────────
ENV_FILE="${SHARED_ENV:-/opt/mlaffon/shared/env}"
if [[ ! -f "$ENV_FILE" ]]; then
  # Fallback to legacy location
  REPO="${REPO:-/opt/mlaffon/mlaffon-tg-app}"
  ENV_FILE="${REPO}/apps/api/.env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: No env file found at $ENV_FILE" >&2
  exit 1
fi

DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL not found in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
if (( PRE_DEPLOY )); then
  FILENAME="mlaffon_predeploy_${DEPLOY_SHA}_${TIMESTAMP}.dump"
else
  FILENAME="mlaffon_${TIMESTAMP}.dump"
fi
FILEPATH="${BACKUP_DIR}/${FILENAME}"

echo "[$(date -Iseconds)] Starting backup → ${FILEPATH}"

pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  "$DATABASE_URL" \
  > "$FILEPATH"

SIZE=$(du -h "$FILEPATH" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: ${FILEPATH} (${SIZE})"

# Verify dump is readable
pg_restore --list "$FILEPATH" > /dev/null 2>&1 || {
  echo "ERROR: Backup verification failed — dump may be corrupt" >&2
  exit 1
}
echo "[$(date -Iseconds)] Backup verified OK"

# Cleanup old backups
find "$BACKUP_DIR" -name "mlaffon_*.dump" -mtime "+${RETENTION_DAYS}" -type f | while read -r old; do
  rm -f "$old"
  echo "[$(date -Iseconds)] Removed old backup: $(basename "$old")"
done

echo "[$(date -Iseconds)] Backup complete. Retention: ${RETENTION_DAYS} days."
