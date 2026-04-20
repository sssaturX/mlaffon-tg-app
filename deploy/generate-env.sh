#!/usr/bin/env bash
# =============================================================================
# deploy/generate-env.sh — interactive production env file generator
#
# Generates /opt/mlaffon/shared/env with auto-generated secrets and prompts
# for values that must be provided by the operator.
#
# Usage:
#   ./deploy/generate-env.sh                 # interactive
#   ./deploy/generate-env.sh --non-interactive  # use defaults/env vars only
#
# Re-running is safe: existing values are preserved; only missing keys are added.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

INTERACTIVE=1
if [[ "${1:-}" == "--non-interactive" ]]; then
  INTERACTIVE=0
fi

ENV_FILE="${SHARED_ENV}"
mkdir -p "$(dirname "$ENV_FILE")"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║          Environment file generator                          ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
log "Target: ${ENV_FILE}"
echo ""

# ── Helpers ──────────────────────────────────────────────────────────────────

# Read existing value from env file, or empty string
existing() {
  read_env_val "$ENV_FILE" "$1"
}

# Prompt user for a value, showing current default
prompt() {
  local key="$1" description="$2" default="$3"
  local current
  current=$(existing "$key")

  if [[ -n "$current" ]]; then
    default="$current"
  fi

  if (( INTERACTIVE )); then
    local prompt_text="  ${key}"
    if [[ -n "$description" ]]; then
      prompt_text="${prompt_text} (${description})"
    fi
    if [[ -n "$default" ]]; then
      prompt_text="${prompt_text} [${default}]"
    fi
    read -r -p "${prompt_text}: " value
    echo "${value:-$default}"
  else
    echo "${current:-$default}"
  fi
}

# Prompt for a secret value (no echo)
prompt_secret() {
  local key="$1" description="$2" default="$3"
  local current
  current=$(existing "$key")

  if [[ -n "$current" ]]; then
    default="$current"
  fi

  if (( INTERACTIVE )) && [[ -z "$current" ]]; then
    local prompt_text="  ${key} (${description})"
    if [[ -n "$default" ]]; then
      prompt_text="${prompt_text} [****]"
    fi
    read -r -s -p "${prompt_text}: " value
    echo ""
    echo "${value:-$default}"
  else
    echo "${current:-$default}"
  fi
}

# Generate a random secret
gen_hex()    { openssl rand -hex "$1" 2>/dev/null; }
gen_base64() { openssl rand -base64 "$1" 2>/dev/null; }

# Write a key=value pair to the env file (append if not present)
write_key() {
  local key="$1" value="$2"
  if [[ -f "$ENV_FILE" ]] && grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# Write a comment line
write_comment() {
  if [[ ! -f "$ENV_FILE" ]] || ! grep -q "^$1" "$ENV_FILE" 2>/dev/null; then
    echo "$1" >> "$ENV_FILE"
  fi
}

# ── Create file if it doesn't exist ─────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Core settings
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "  ${BOLD}Core settings:${RESET}"

NODE_ENV=$(prompt "NODE_ENV" "production for prod" "production")
write_key "NODE_ENV" "$NODE_ENV"

PORT=$(prompt "PORT" "API port" "3001")
write_key "PORT" "$PORT"

HOST=$(prompt "HOST" "API bind address" "0.0.0.0")
write_key "HOST" "$HOST"

# ═══════════════════════════════════════════════════════════════════════════════
# Database
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}Database:${RESET}"

DEFAULT_DB_URL="postgres://mlaffon:mlaffon@127.0.0.1:5432/mlaffon"
DATABASE_URL=$(prompt "DATABASE_URL" "PostgreSQL connection" "$DEFAULT_DB_URL")
write_key "DATABASE_URL" "$DATABASE_URL"

# ═══════════════════════════════════════════════════════════════════════════════
# Redis
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}Redis:${RESET}"

REDIS_URL=$(prompt "REDIS_URL" "Redis connection" "redis://127.0.0.1:6379")
write_key "REDIS_URL" "$REDIS_URL"

# ═══════════════════════════════════════════════════════════════════════════════
# Secrets (auto-generated if not present)
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}Secrets (auto-generated if missing):${RESET}"

JWT_SECRET=$(existing "JWT_SECRET")
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET=$(gen_hex 32)
  ok "JWT_SECRET: auto-generated"
else
  ok "JWT_SECRET: already set"
fi
write_key "JWT_SECRET" "$JWT_SECRET"

ADMIN_JWT_SECRET=$(existing "ADMIN_JWT_SECRET")
if [[ -z "$ADMIN_JWT_SECRET" ]]; then
  ADMIN_JWT_SECRET=$(gen_hex 32)
  ok "ADMIN_JWT_SECRET: auto-generated"
else
  ok "ADMIN_JWT_SECRET: already set"
fi
write_key "ADMIN_JWT_SECRET" "$ADMIN_JWT_SECRET"

TOKENS_ENCRYPTION_KEY=$(existing "TOKENS_ENCRYPTION_KEY")
if [[ -z "$TOKENS_ENCRYPTION_KEY" ]]; then
  TOKENS_ENCRYPTION_KEY=$(gen_base64 32)
  ok "TOKENS_ENCRYPTION_KEY: auto-generated"
else
  ok "TOKENS_ENCRYPTION_KEY: already set"
fi
write_key "TOKENS_ENCRYPTION_KEY" "$TOKENS_ENCRYPTION_KEY"

# ═══════════════════════════════════════════════════════════════════════════════
# Telegram
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}Telegram:${RESET}"

TELEGRAM_BOT_TOKEN=$(prompt_secret "TELEGRAM_BOT_TOKEN" "from @BotFather" "")
if [[ -n "$TELEGRAM_BOT_TOKEN" ]]; then
  write_key "TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN"
  ok "TELEGRAM_BOT_TOKEN: set"
else
  warn "TELEGRAM_BOT_TOKEN: not set (required)"
fi

TELEGRAM_BOT_USERNAME=$(prompt "TELEGRAM_BOT_USERNAME" "bot username" "MlaffonBot")
write_key "TELEGRAM_BOT_USERNAME" "$TELEGRAM_BOT_USERNAME"

# ═══════════════════════════════════════════════════════════════════════════════
# Public URLs
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}Public URLs:${RESET}"

PUBLIC_WEB_URL=$(prompt "PUBLIC_WEB_URL" "main site URL" "https://mlaffon.fun")
write_key "PUBLIC_WEB_URL" "$PUBLIC_WEB_URL"

PUBLIC_ADMIN_URL=$(prompt "PUBLIC_ADMIN_URL" "admin panel URL" "https://admin.mlaffon.fun")
write_key "PUBLIC_ADMIN_URL" "$PUBLIC_ADMIN_URL"

CORS_ORIGINS=$(prompt "CORS_ORIGINS" "comma-separated" "${PUBLIC_WEB_URL},${PUBLIC_ADMIN_URL}")
write_key "CORS_ORIGINS" "$CORS_ORIGINS"

# ═══════════════════════════════════════════════════════════════════════════════
# OAuth (optional)
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}OAuth (leave empty to skip):${RESET}"

TWITCH_CLIENT_ID=$(prompt "TWITCH_CLIENT_ID" "Twitch app ID" "$(existing "TWITCH_CLIENT_ID")")
if [[ -n "$TWITCH_CLIENT_ID" ]]; then
  write_key "TWITCH_CLIENT_ID" "$TWITCH_CLIENT_ID"
  TWITCH_CLIENT_SECRET=$(prompt_secret "TWITCH_CLIENT_SECRET" "Twitch app secret" "$(existing "TWITCH_CLIENT_SECRET")")
  [[ -n "$TWITCH_CLIENT_SECRET" ]] && write_key "TWITCH_CLIENT_SECRET" "$TWITCH_CLIENT_SECRET"
  TWITCH_REDIRECT_URI=$(prompt "TWITCH_REDIRECT_URI" "callback URL" "${PUBLIC_WEB_URL%%/}/api/v1/oauth/twitch/callback")
  write_key "TWITCH_REDIRECT_URI" "$TWITCH_REDIRECT_URI"
fi

KICK_CLIENT_ID=$(prompt "KICK_CLIENT_ID" "Kick app ID" "$(existing "KICK_CLIENT_ID")")
if [[ -n "$KICK_CLIENT_ID" ]]; then
  write_key "KICK_CLIENT_ID" "$KICK_CLIENT_ID"
  KICK_CLIENT_SECRET=$(prompt_secret "KICK_CLIENT_SECRET" "Kick app secret" "$(existing "KICK_CLIENT_SECRET")")
  [[ -n "$KICK_CLIENT_SECRET" ]] && write_key "KICK_CLIENT_SECRET" "$KICK_CLIENT_SECRET"
  KICK_REDIRECT_URI=$(prompt "KICK_REDIRECT_URI" "callback URL" "${PUBLIC_WEB_URL%%/}/api/v1/oauth/kick/callback")
  write_key "KICK_REDIRECT_URI" "$KICK_REDIRECT_URI"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Admin credentials
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}Admin credentials:${RESET}"

ADMIN_EMAIL=$(prompt "ADMIN_EMAIL" "admin login email" "$(existing "ADMIN_EMAIL")")
[[ -n "$ADMIN_EMAIL" ]] && write_key "ADMIN_EMAIL" "$ADMIN_EMAIL"

ADMIN_PASSWORD=$(prompt_secret "ADMIN_PASSWORD" "admin login password" "$(existing "ADMIN_PASSWORD")")
[[ -n "$ADMIN_PASSWORD" ]] && write_key "ADMIN_PASSWORD" "$ADMIN_PASSWORD"

ADMIN_PASSPHRASE=$(prompt_secret "ADMIN_PASSPHRASE" "admin passphrase" "$(existing "ADMIN_PASSPHRASE")")
[[ -n "$ADMIN_PASSPHRASE" ]] && write_key "ADMIN_PASSPHRASE" "$ADMIN_PASSPHRASE"

# ═══════════════════════════════════════════════════════════════════════════════
# Frontend env
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}Frontend:${RESET}"

VITE_BOT_USERNAME=$(prompt "VITE_BOT_USERNAME" "bot username for frontend" "$TELEGRAM_BOT_USERNAME")
write_key "VITE_BOT_USERNAME" "$VITE_BOT_USERNAME"

# ═══════════════════════════════════════════════════════════════════════════════
# CDN
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "  ${BOLD}CDN:${RESET}"

CDN_PROVIDER_VAL=$(prompt "CDN_PROVIDER" "yandex|cloudflare|none" "yandex")
write_key "CDN_PROVIDER" "$CDN_PROVIDER_VAL"

if [[ "$CDN_PROVIDER_VAL" == "yandex" ]]; then
  YC_CDN_RESOURCE_ID=$(prompt "YC_CDN_RESOURCE_ID" "Yandex CDN resource ID" "$(existing "YC_CDN_RESOURCE_ID")")
  [[ -n "$YC_CDN_RESOURCE_ID" ]] && write_key "YC_CDN_RESOURCE_ID" "$YC_CDN_RESOURCE_ID"

  YC_FOLDER_ID=$(prompt "YC_FOLDER_ID" "Yandex Cloud folder ID" "$(existing "YC_FOLDER_ID")")
  [[ -n "$YC_FOLDER_ID" ]] && write_key "YC_FOLDER_ID" "$YC_FOLDER_ID"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
chmod 600 "$ENV_FILE"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║                 Environment file created                     ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  File: ${ENV_FILE}"
echo -e "  Permissions: $(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo "600")"
echo -e "  Keys: $(grep -c '=' "$ENV_FILE" 2>/dev/null || echo "?")"
echo ""

# Validation
MISSING=0
for key in DATABASE_URL REDIS_URL JWT_SECRET TELEGRAM_BOT_TOKEN TOKENS_ENCRYPTION_KEY NODE_ENV; do
  val=$(read_env_val "$ENV_FILE" "$key")
  if [[ -z "$val" ]]; then
    warn "Missing required key: ${key}"
    MISSING=$((MISSING + 1))
  fi
done

if (( MISSING > 0 )); then
  echo ""
  warn "${MISSING} required key(s) still missing — edit ${ENV_FILE} manually to add them"
else
  ok "All required keys present"
fi

echo ""
echo -e "  ${BOLD}Next:${RESET} Run ${BOLD}./deploy/release.sh <tag>${RESET} to deploy"
echo ""
