#!/usr/bin/env bash
# =============================================================================
# PostgreSQL restore from backup
# Usage:
#   ./deploy/restore.sh /opt/mlaffon/backups/mlaffon_20260420_020000.dump
# =============================================================================
set -euo pipefail

DUMP_FILE="${1:-}"
REPO="${REPO:-/opt/mlaffon/mlaffon-tg-app}"
ENV_FILE="${REPO}/apps/api/.env"

if [[ -z "$DUMP_FILE" ]]; then
  echo "Usage: $0 <path-to-dump-file>" >&2
  echo "" >&2
  echo "Available backups:" >&2
  ls -lht /opt/mlaffon/backups/mlaffon_*.dump 2>/dev/null || echo "  (none found)"
  exit 1
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: File not found: $DUMP_FILE" >&2
  exit 1
fi

DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL not found in $ENV_FILE" >&2
  exit 1
fi

echo "WARNING: This will REPLACE the current database contents."
echo "File: $DUMP_FILE"
echo "Target: $DATABASE_URL"
echo ""
read -rp "Continue? (type YES to confirm): " confirm
if [[ "$confirm" != "YES" ]]; then
  echo "Aborted."
  exit 0
fi

echo "[$(date -Iseconds)] Stopping services..."
sudo systemctl stop mlaffon-api mlaffon-worker 2>/dev/null || true

echo "[$(date -Iseconds)] Restoring from ${DUMP_FILE}..."
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$DATABASE_URL" \
  "$DUMP_FILE"

echo "[$(date -Iseconds)] Restore complete. Restarting services..."
sudo systemctl start mlaffon-api mlaffon-worker

echo "[$(date -Iseconds)] Verifying health..."
sleep 3
curl -sf http://127.0.0.1:3001/health || echo "WARNING: Health check failed"

echo "[$(date -Iseconds)] Done."
