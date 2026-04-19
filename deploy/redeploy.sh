#!/usr/bin/env bash
#
# Продовый redeploy:
# git pull -> (docker compose up postgres/redis + wait health) -> npm ci -> build
# -> db push (retry) -> db:sync-faq (FAQ из кода в БД) -> db:seed (опционально) -> chmod/rights -> systemd: копирование unit из deploy/, daemon-reload, enable + restart
#    (mlaffon-api, mlaffon-worker, mlaffon-worker-fraud) -> health checks.
#
# Broadcast/realtime: основной worker обязателен; worker-fraud — по умолчанию тоже ставится и перезапускается.
#
# Использование:
#   chmod +x deploy/redeploy.sh
#   ./deploy/redeploy.sh
#
# Переменные окружения:
#   REPO=/opt/mlaffon/mlaffon-tg-app
#   DEPLOY_SKIP_DB=1           # не выполнять db:push / db:sync-faq / db:seed
#   DEPLOY_DB_SEED=0           # НЕ выполнять db:seed (по умолчанию seed включён)
#   DEPLOY_SKIP_FAQ_SYNC=1     # не выполнять db:sync-faq (по умолчанию FAQ мержится из кода в БД)
#   DEPLOY_SKIP_INFRA=1        # не запускать docker compose postgres/redis
#   DEPLOY_CADDY=1             # обновить /etc/caddy/Caddyfile и reload
#   DEPLOY_DB_RETRIES=5        # кол-во retry для db:push
#   DEPLOY_DB_RETRY_DELAY=3    # сек между retry
#   DEPLOY_DB_SEED_RETRIES=3   # retry для db:seed
#   DEPLOY_DB_SEED_RETRY_DELAY=3
#   DEPLOY_SYSTEMD_DAEMON_RELOAD=1  # перед enable/restart выполнить daemon-reload (по умолчанию 1)
#   DEPLOY_SKIP_SYSTEMD_COPY=1      # не копировать unit из deploy/ (если правите их вручную на сервере)
#   DEPLOY_SKIP_WORKER_FRAUD=1        # не копировать/не enable/не restart mlaffon-worker-fraud
#   DEPLOY_TELEGRAM_WEBHOOK_SECRET=1 # сгенерировать TELEGRAM_WEBHOOK_SECRET в apps/api/.env, если пусто
#   TELEGRAM_WEBHOOK_SECRET=...      # в deploy.env — записать в apps/api/.env (вебхук)
#   DEPLOY_SKIP_TELEGRAM_CHECK=1     # не проверять TELEGRAM_BOT_TOKEN в apps/api/.env
#   DEPLOY_SKIP_ENV_SECURITY=1       # не дописывать CORS/WS/auth defaults в apps/api/.env
#   DEPLOY_CORS_AUTO_ADMIN=1         # (по умолчанию 1) если нет PUBLIC_ADMIN_URL — добавить https://admin.<хост>
#   DEPLOY_AUTO_PRODUCTION_CORS=1    # (по умолчанию 1) при автогенерации CORS дописать NODE_ENV=production, если ещё нет
#
# Web Push: после npm ci скрипт дописывает VAPID_* в apps/api/.env.
# CORS / security: при пустом CORS_ORIGINS берётся https-домен из PUBLIC_WEB_URL, MINI_APP_WEB_URL или
# origin из TWITCH_REDIRECT_URI / KICK_REDIRECT_URI; пишется CORS_ORIGINS (+ admin поддомен);
# при DEPLOY_AUTO_PRODUCTION_CORS=1 и отсутствии NODE_ENV дописывается production. Дефолты WS/auth — как раньше.
#
# Медиа (S3/CDN): при DEPLOY_MERGE_DEPLOY_ENV_INTO_API=1 из export в deploy/deploy.env в apps/api/.env
# дописываются только отсутствующие ключи: MEDIA_S3_BUCKET, MEDIA_PUBLIC_BASE_URL, MEDIA_S3_REGION,
# MEDIA_S3_ENDPOINT, MEDIA_S3_FORCE_PATH_STYLE, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (см. deploy/IMAGES.md).
#
# Telegram:
#   — В apps/api/.env обязателен непустой TELEGRAM_BOT_TOKEN (отключить проверку: DEPLOY_SKIP_TELEGRAM_CHECK=1).
#   — Long polling (по умолчанию): не задавайте TELEGRAM_WEBHOOK_SECRET в .env и не экспортируйте его из deploy.env.
#   — Вебхук: задайте TELEGRAM_WEBHOOK_SECRET в deploy/deploy.env (export) ИЛИ DEPLOY_TELEGRAM_WEBHOOK_SECRET=1
#     (тогда скрипт сгенерирует секрет и запишет в apps/api/.env, если строки ещё нет). Затем setWebhook.
#

set -euo pipefail

REPO="${REPO:-/opt/mlaffon/mlaffon-tg-app}"
DEPLOY_DB_RETRIES="${DEPLOY_DB_RETRIES:-5}"
DEPLOY_DB_RETRY_DELAY="${DEPLOY_DB_RETRY_DELAY:-3}"
DEPLOY_DB_SEED_RETRIES="${DEPLOY_DB_SEED_RETRIES:-3}"
DEPLOY_DB_SEED_RETRY_DELAY="${DEPLOY_DB_SEED_RETRY_DELAY:-3}"
DEPLOY_DB_SEED="${DEPLOY_DB_SEED:-1}"
DEPLOY_SKIP_FAQ_SYNC="${DEPLOY_SKIP_FAQ_SYNC:-0}"
DEPLOY_FAQ_SYNC_RETRIES="${DEPLOY_FAQ_SYNC_RETRIES:-3}"
DEPLOY_FAQ_SYNC_RETRY_DELAY="${DEPLOY_FAQ_SYNC_RETRY_DELAY:-3}"
DEPLOY_SYSTEMD_DAEMON_RELOAD="${DEPLOY_SYSTEMD_DAEMON_RELOAD:-1}"
DEPLOY_HEALTH_RETRIES="${DEPLOY_HEALTH_RETRIES:-15}"
DEPLOY_HEALTH_RETRY_DELAY="${DEPLOY_HEALTH_RETRY_DELAY:-2}"

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
fi

log() {
  echo "==> $*"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Не найдена команда '$1'"
}

run_with_retries() {
  local retries="$1"
  local delay_s="$2"
  shift 2
  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi
    if (( attempt >= retries )); then
      return 1
    fi
    log "попытка ${attempt}/${retries} неудачна, повтор через ${delay_s}s"
    sleep "$delay_s"
    attempt=$((attempt + 1))
  done
}

assert_repo() {
  [[ -d "$REPO" ]] || die "Нет каталога REPO=$REPO"
  [[ -f "$REPO/package.json" ]] || die "В $REPO нет package.json (не корень монорепо)"
  [[ -f "$REPO/apps/api/.env" ]] || die "Нет $REPO/apps/api/.env"
  [[ -f "$REPO/apps/api/package.json" ]] || die "Нет $REPO/apps/api/package.json"
}

assert_required_env_vars_core() {
  local envf="$REPO/apps/api/.env"
  grep -qE '^DATABASE_URL=' "$envf" || die "В $envf отсутствует DATABASE_URL"
  grep -qE '^REDIS_URL=' "$envf" || die "В $envf отсутствует REDIS_URL"
}

assert_required_env_vars_production() {
  local envf="$REPO/apps/api/.env"
  if ! grep -qE '^NODE_ENV=production' "$envf"; then
    return 0
  fi
  local cors
  cors="$(sed -n 's/^CORS_ORIGINS=//p' "$envf" | sed -n '1p' | tr -d '\r' | tr -d '[:space:]')"
  [[ -n "$cors" ]] || die "production: в $envf пустой CORS_ORIGINS (проверьте PUBLIC_WEB_URL / MINI_APP_WEB_URL / OAuth redirect или задайте CORS_ORIGINS вручную)"
}

assert_api_scripts() {
  local pkg="$REPO/apps/api/package.json"
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const s = p && p.scripts ? p.scripts : {};
    const miss = ['build','db:push','db:seed','db:sync-faq'].filter((k) => typeof s[k] !== 'string');
    if (miss.length) {
      console.error('missing scripts in apps/api/package.json:', miss.join(', '));
      process.exit(1);
    }
  " "$pkg" || die "Проверьте scripts в $pkg (нужны build, db:push, db:seed, db:sync-faq)"
}

wait_compose_service_healthy() {
  local service="$1"
  local max_wait_s="${2:-120}"
  local waited=0
  local cid
  cid="$(docker compose -f "$REPO/docker-compose.yml" ps -q "$service")"
  [[ -n "$cid" ]] || die "Не найден контейнер для сервиса '$service'"
  while (( waited < max_wait_s )); do
    local state
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
    if [[ "$state" == "healthy" || "$state" == "running" ]]; then
      log "сервис $service готов ($state)"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  die "Сервис $service не стал healthy/running за ${max_wait_s}s"
}

ensure_infra() {
  if [[ "${DEPLOY_SKIP_INFRA:-0}" == "1" ]]; then
    log "пропуск запуска инфраструктуры (DEPLOY_SKIP_INFRA=1)"
    return 0
  fi
  require_cmd docker
  [[ -f "$REPO/docker-compose.yml" ]] || die "Нет $REPO/docker-compose.yml"
  log "docker compose up -d postgres redis"
  docker compose -f "$REPO/docker-compose.yml" up -d postgres redis
  wait_compose_service_healthy postgres 180
  wait_compose_service_healthy redis 120
}

ensure_vapid_in_api_env() {
  local envf="$REPO/apps/api/.env"
  local subject="${VAPID_SUBJECT:-mailto:itoly569@gmail.com}"
  local pub="${VAPID_PUBLIC_KEY:-}"
  local priv="${VAPID_PRIVATE_KEY:-}"

  if [[ -z "$pub" || -z "$priv" ]]; then
    if grep -qE '^VAPID_PUBLIC_KEY=' "$envf" && grep -qE '^VAPID_PRIVATE_KEY=' "$envf"; then
      log "VAPID ключи уже есть в $envf (обновлю subject)"
      pub="$(sed -n 's/^VAPID_PUBLIC_KEY=//p' "$envf" | sed -n '1p')"
      priv="$(sed -n 's/^VAPID_PRIVATE_KEY=//p' "$envf" | sed -n '1p')"
    else
      log "генерация VAPID ключей (web-push)"
      local keys
      keys="$(
        cd "$REPO/apps/api" && node -e "
          const w = require('web-push');
          const k = w.generateVAPIDKeys();
          console.log(k.publicKey);
          console.log(k.privateKey);
        "
      )"
      pub="$(printf '%s\n' "$keys" | sed -n '1p')"
      priv="$(printf '%s\n' "$keys" | sed -n '2p')"
    fi
  else
    log "VAPID ключи взяты из окружения"
  fi

  local tmp
  tmp="$(mktemp)"
  sed '/^VAPID_PUBLIC_KEY=/d;/^VAPID_PRIVATE_KEY=/d;/^VAPID_SUBJECT=/d' "$envf" >"$tmp" || true
  {
    sed -n '1,$p' "$tmp"
    echo "VAPID_SUBJECT=${subject}"
    echo "VAPID_PUBLIC_KEY=${pub}"
    echo "VAPID_PRIVATE_KEY=${priv}"
  } >"${envf}.new"
  mv "${envf}.new" "$envf"
  rm -f "$tmp"
  log "обновлены VAPID_* в $envf"
}

ensure_telegram_webhook_secret_in_api_env() {
  local envf="$REPO/apps/api/.env"
  local sec="${TELEGRAM_WEBHOOK_SECRET:-}"
  local generated=0

  if [[ -z "$sec" ]]; then
    local existing
    existing="$(sed -n 's/^TELEGRAM_WEBHOOK_SECRET=//p' "$envf" 2>/dev/null | sed -n '1p' | tr -d '\r')"
    if [[ -n "${existing// /}" ]]; then
      sec="$existing"
      log "TELEGRAM_WEBHOOK_SECRET уже в $envf, оставляю"
    else
      log "генерация TELEGRAM_WEBHOOK_SECRET (64 hex)"
      sec="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
      generated=1
    fi
  else
    log "TELEGRAM_WEBHOOK_SECRET из окружения → запись в $envf"
  fi

  local tmp
  tmp="$(mktemp)"
  sed '/^TELEGRAM_WEBHOOK_SECRET=/d' "$envf" >"$tmp" || true
  {
    cat "$tmp"
    echo "TELEGRAM_WEBHOOK_SECRET=${sec}"
  } >"${envf}.new"
  mv "${envf}.new" "$envf"
  rm -f "$tmp"
  log "TELEGRAM_WEBHOOK_SECRET записан в $envf"
  if [[ "$generated" == "1" ]]; then
    log "Telegram: один раз вызовите setWebhook с url=.../api/v1/telegram/webhook и этим secret_token"
  fi
}

assert_telegram_bot_token_in_api_env() {
  if [[ "${DEPLOY_SKIP_TELEGRAM_CHECK:-0}" == "1" ]]; then
    return 0
  fi
  local envf="$REPO/apps/api/.env"
  grep -qE '^TELEGRAM_BOT_TOKEN=' "$envf" || die "В $envf нет TELEGRAM_BOT_TOKEN (или DEPLOY_SKIP_TELEGRAM_CHECK=1)"
  local tok
  tok="$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$envf" | sed -n '1p' | tr -d '\r' | tr -d '[:space:]')"
  [[ -n "$tok" ]] || die "В $envf TELEGRAM_BOT_TOKEN пустой"
}

# Вебхук: секрет из deploy.env или генерация по флагу. Иначе — long polling, строку TELEGRAM_WEBHOOK_SECRET в .env не трогаем.
configure_telegram_for_deploy() {
  local envf="$REPO/apps/api/.env"
  local sync_secret=0
  if [[ "${DEPLOY_TELEGRAM_WEBHOOK_SECRET:-0}" == "1" ]]; then
    sync_secret=1
  fi
  if [[ -n "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
    sync_secret=1
  fi

  if [[ "$sync_secret" == "1" ]]; then
    ensure_telegram_webhook_secret_in_api_env
    log "Telegram: режим вебхука — при смене секрета обновите setWebhook"
    return
  fi

  local existing
  existing="$(sed -n 's/^TELEGRAM_WEBHOOK_SECRET=//p' "$envf" 2>/dev/null | sed -n '1p' | tr -d '\r')"
  if [[ -n "${existing// /}" ]]; then
    log "Telegram: в $envf задан TELEGRAM_WEBHOOK_SECRET — вебхук (API без long polling)"
  else
    log "Telegram: секрет вебхука не задан — long polling, setWebhook не нужен"
  fi
}

# Если в apps/api/.env ключа нет, а в окружении (deploy/deploy.env) он есть — дописать в .env (systemd читает только .env).
sync_env_var_into_api_if_missing() {
  local envf="$1" key="$2"
  local val
  val="$(printenv "$key" 2>/dev/null || true)"
  val="${val//$'\r'/}"
  [[ -n "${val// }" ]] || return 0
  local cur
  cur="$(sed -n "s/^${key}=//p" "$envf" 2>/dev/null | head -1 | tr -d '\r')"
  [[ -z "${cur// }" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  sed "/^${key}=/d" "$envf" >"$tmp" || true
  {
    cat "$tmp"
    echo "${key}=${val}"
  } >"${envf}.new"
  mv "${envf}.new" "$envf"
  rm -f "$tmp"
  log "из окружения деплоя записан ${key} в apps/api/.env"
}

read_kv_from_envfile() {
  local envf="$1" key="$2"
  [[ -f "$envf" ]] || { echo ""; return 0; }
  sed -n "s/^${key}=//p" "$envf" 2>/dev/null | head -1 | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s#/\+$##'
}

origin_from_oauth_redirect_uri() {
  local u="$1"
  [[ -n "${u// }" ]] || { echo ""; return 0; }
  if [[ "$u" =~ ^(https?://[^/:?#]+) ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo ""
  fi
}

url_is_nonlocal_https() {
  local u="$1"
  [[ "$u" =~ ^https:// ]] || return 1
  [[ "$u" == *localhost* ]] && return 1
  [[ "$u" == *127.0.0.1* ]] && return 1
  return 0
}

# Публичный https-домен для CORS: приоритет PUBLIC_WEB_URL → MINI_APP_WEB_URL → Twitch/Kick redirect.
resolve_pub_for_cors() {
  local envf="$1"
  local a b c d x
  a="$(read_kv_from_envfile "$envf" PUBLIC_WEB_URL)"
  b="$(read_kv_from_envfile "$envf" MINI_APP_WEB_URL)"
  c="$(origin_from_oauth_redirect_uri "$(read_kv_from_envfile "$envf" TWITCH_REDIRECT_URI)")"
  d="$(origin_from_oauth_redirect_uri "$(read_kv_from_envfile "$envf" KICK_REDIRECT_URI)")"
  for x in "$a" "$b" "$c" "$d"; do
    [[ -z "$x" ]] && continue
    if url_is_nonlocal_https "$x"; then
      echo "$x"
      return 0
    fi
  done
  for x in "$a" "$b" "$c" "$d"; do
    if [[ -n "$x" ]]; then
      echo "$x"
      return 0
    fi
  done
  echo ""
}

# Дописывает в apps/api/.env недостающие ключи (WS ticket, auth RL) и при NODE_ENV=production — CORS_ORIGINS.
append_env_if_missing_or_empty() {
  local envf="$1" key="$2" default="$3"
  if grep -qE "^${key}=" "$envf" 2>/dev/null; then
    local cur
    cur="$(sed -n "s/^${key}=//p" "$envf" | head -1 | tr -d '\r')"
    if [[ -n "${cur// /}" ]]; then
      return 0
    fi
  fi
  local tmp
  tmp="$(mktemp)"
  sed "/^${key}=/d" "$envf" >"$tmp" || true
  {
    cat "$tmp"
    echo "${key}=${default}"
  } >"${envf}.new"
  mv "${envf}.new" "$envf"
  rm -f "$tmp"
  log "добавлен ${key} в apps/api/.env"
}

ensure_api_env_security_defaults() {
  if [[ "${DEPLOY_SKIP_ENV_SECURITY:-0}" == "1" ]]; then
    log "пропуск автоконфига CORS/security (DEPLOY_SKIP_ENV_SECURITY=1)"
    return 0
  fi

  local envf="$REPO/apps/api/.env"

  if [[ "${DEPLOY_MERGE_DEPLOY_ENV_INTO_API:-1}" == "1" ]]; then
    sync_env_var_into_api_if_missing "$envf" NODE_ENV
    sync_env_var_into_api_if_missing "$envf" PUBLIC_WEB_URL
    sync_env_var_into_api_if_missing "$envf" PUBLIC_ADMIN_URL
    sync_env_var_into_api_if_missing "$envf" MINI_APP_WEB_URL
       sync_env_var_into_api_if_missing "$envf" CORS_ORIGINS
  fi

  if [[ "${DEPLOY_ASSUME_PRODUCTION_API:-0}" == "1" ]]; then
    append_env_if_missing_or_empty "$envf" NODE_ENV production
  fi

  append_env_if_missing_or_empty "$envf" WS_TICKET_TTL_SEC 25
  append_env_if_missing_or_empty "$envf" WS_CONNECT_ATTEMPTS_PER_MINUTE 30
  append_env_if_missing_or_empty "$envf" WS_MAX_CONCURRENT_PER_IP 8
  append_env_if_missing_or_empty "$envf" AUTH_RATE_LIMIT_MAX 15
  append_env_if_missing_or_empty "$envf" AUTH_RATE_LIMIT_WINDOW_MS 900000

  # --- CORS для production: подстановка CORS_ORIGINS в apps/api/.env ---
  local cors_cur
  cors_cur="$(sed -n 's/^CORS_ORIGINS=//p' "$envf" | head -1 | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [[ -n "$cors_cur" ]]; then
    log "CORS_ORIGINS уже задан — не меняю"
    return 0
  fi

  if grep -qE '^NODE_ENV=development' "$envf"; then
    log "NODE_ENV=development — автогенерация CORS пропущена"
    return 0
  fi

  local pub admin auto_admin host tmp origins
  pub="$(resolve_pub_for_cors "$envf")"
  if [[ -z "$pub" ]]; then
    if grep -qE '^NODE_ENV=production' "$envf"; then
      die "production: пустой CORS_ORIGINS и не найден URL в PUBLIC_WEB_URL, MINI_APP_WEB_URL, TWITCH_REDIRECT_URI, KICK_REDIRECT_URI — задайте PUBLIC_WEB_URL=https://ваш.домен в $envf"
    fi
    log "автогенерация CORS: не найден ни один из PUBLIC_WEB_URL / MINI_APP_WEB_URL / OAuth redirect — пропуск"
    return 0
  fi

  if ! url_is_nonlocal_https "$pub"; then
    if grep -qE '^NODE_ENV=production' "$envf"; then
      die "production: для CORS нужен https:// домен (не localhost). Сейчас base=${pub} — поправьте PUBLIC_WEB_URL или OAuth redirect в $envf"
    fi
    log "автогенерация CORS: базовый URL не продакшен-https (${pub}) — пропуск"
    return 0
  fi

  if [[ "${DEPLOY_AUTO_PRODUCTION_CORS:-1}" != "0" ]]; then
    if ! grep -qE '^NODE_ENV=production' "$envf"; then
      append_env_if_missing_or_empty "$envf" NODE_ENV production
      log "дописан NODE_ENV=production (авто для CORS с ${pub})"
    fi
  elif ! grep -qE '^NODE_ENV=production' "$envf"; then
    log "NODE_ENV не production и DEPLOY_AUTO_PRODUCTION_CORS=0 — CORS_ORIGINS не генерирую"
    return 0
  fi

  admin="$(read_kv_from_envfile "$envf" PUBLIC_ADMIN_URL)"

  auto_admin=""
  if [[ -z "$admin" && "${DEPLOY_CORS_AUTO_ADMIN:-1}" == "1" ]]; then
    if [[ "$pub" =~ ^https?://([^/:?#]+) ]]; then
      host="${BASH_REMATCH[1]}"
      if [[ "$host" == admin.* ]]; then
        auto_admin=""
      else
        auto_admin="https://admin.${host}"
      fi
    fi
  fi

  origins="$pub"
  if [[ -n "$admin" ]]; then
    if [[ ",${origins}," != *",${admin},"* ]]; then
      origins="${origins},${admin}"
    fi
  elif [[ -n "$auto_admin" ]]; then
    if [[ ",${origins}," != *",${auto_admin},"* ]]; then
      origins="${origins},${auto_admin}"
    fi
  fi

  tmp="$(mktemp)"
  sed '/^CORS_ORIGINS=/d' "$envf" >"$tmp" || true
  {
    cat "$tmp"
    echo "CORS_ORIGINS=${origins}"
  } >"${envf}.new"
  mv "${envf}.new" "$envf"
  rm -f "$tmp"
  log "записан CORS_ORIGINS=${origins} (источник базы: resolve из .env)"

  if [[ -z "$admin" && -n "$auto_admin" ]]; then
    tmp="$(mktemp)"
    sed '/^PUBLIC_ADMIN_URL=/d' "$envf" >"$tmp" || true
    {
      cat "$tmp"
      echo "PUBLIC_ADMIN_URL=${auto_admin}"
    } >"${envf}.new"
    mv "${envf}.new" "$envf"
    rm -f "$tmp"
    log "добавлен PUBLIC_ADMIN_URL=${auto_admin} (поддомен admin.* от базы CORS)"
  fi
}

reload_caddy_if_requested() {
  if [[ "${DEPLOY_CADDY:-0}" != "1" ]]; then
    return 0
  fi
  log "Caddy: обновление конфига из deploy/Caddyfile"
  $SUDO cp "$REPO/deploy/Caddyfile" /etc/caddy/Caddyfile
  $SUDO caddy fmt --overwrite /etc/caddy/Caddyfile
  $SUDO caddy validate --config /etc/caddy/Caddyfile
  $SUDO systemctl reload caddy
}

systemd_reload_if_requested() {
  if [[ "$DEPLOY_SYSTEMD_DAEMON_RELOAD" != "1" ]]; then
    return 0
  fi
  log "systemctl daemon-reload"
  $SUDO systemctl daemon-reload
}

# Копирует unit из репозитория, enable при автозапуске, restart — один вызов «без ручных шагов».
install_and_restart_mlaffon_systemd() {
  if [[ "${DEPLOY_SKIP_SYSTEMD_COPY:-0}" != "1" ]]; then
    log "копирование systemd unit → /etc/systemd/system/"
    [[ -f "$REPO/deploy/mlaffon-api.service" ]] || die "Нет $REPO/deploy/mlaffon-api.service"
    [[ -f "$REPO/deploy/mlaffon-worker.service" ]] || die "Нет $REPO/deploy/mlaffon-worker.service"
    $SUDO cp "$REPO/deploy/mlaffon-api.service" /etc/systemd/system/
    $SUDO cp "$REPO/deploy/mlaffon-worker.service" /etc/systemd/system/
    if [[ "${DEPLOY_SKIP_WORKER_FRAUD:-0}" != "1" ]]; then
      if [[ -f "$REPO/deploy/mlaffon-worker-fraud.service" ]]; then
        $SUDO cp "$REPO/deploy/mlaffon-worker-fraud.service" /etc/systemd/system/
      else
        log "предупреждение: нет $REPO/deploy/mlaffon-worker-fraud.service — fraud-worker не копируется"
      fi
    fi
  else
    log "пропуск копирования unit (DEPLOY_SKIP_SYSTEMD_COPY=1)"
  fi

  systemd_reload_if_requested

  local units=(mlaffon-api mlaffon-worker)
  if [[ "${DEPLOY_SKIP_WORKER_FRAUD:-0}" != "1" ]] && [[ -f /etc/systemd/system/mlaffon-worker-fraud.service ]]; then
    units+=(mlaffon-worker-fraud)
  fi

  log "systemctl enable ${units[*]}"
  $SUDO systemctl enable "${units[@]}"

  log "systemctl restart ${units[*]}"
  $SUDO systemctl restart "${units[@]}"
}

show_mlaffon_units_status() {
  $SUDO systemctl is-active mlaffon-api mlaffon-worker 2>/dev/null || true
  if [[ -f /etc/systemd/system/mlaffon-worker-fraud.service ]]; then
    $SUDO systemctl is-active mlaffon-worker-fraud 2>/dev/null || true
  fi
}

run_db_sync() {
  if [[ "${DEPLOY_SKIP_DB:-0}" == "1" ]]; then
    log "пропуск db:push / db:sync-faq / db:seed (DEPLOY_SKIP_DB=1)"
    return 0
  fi
  log "db:push (apps/api) с retry=${DEPLOY_DB_RETRIES}"
  run_with_retries "$DEPLOY_DB_RETRIES" "$DEPLOY_DB_RETRY_DELAY" bash -lc "cd '$REPO/apps/api' && npm run db:push" \
    || die "db:push не удалось после ${DEPLOY_DB_RETRIES} попыток"

  if [[ "${DEPLOY_SKIP_FAQ_SYNC:-0}" != "1" ]]; then
    log "db:sync-faq (слияние FAQ из кода в app_settings) retry=${DEPLOY_FAQ_SYNC_RETRIES}"
    run_with_retries "$DEPLOY_FAQ_SYNC_RETRIES" "$DEPLOY_FAQ_SYNC_RETRY_DELAY" bash -lc "cd '$REPO/apps/api' && npm run db:sync-faq" \
      || die "db:sync-faq не удалось после ${DEPLOY_FAQ_SYNC_RETRIES} попыток"
  else
    log "пропуск db:sync-faq (DEPLOY_SKIP_FAQ_SYNC=1)"
  fi

  if [[ "$DEPLOY_DB_SEED" != "0" ]]; then
    log "db:seed (apps/api) с retry=${DEPLOY_DB_SEED_RETRIES}"
    run_with_retries "$DEPLOY_DB_SEED_RETRIES" "$DEPLOY_DB_SEED_RETRY_DELAY" bash -lc "cd '$REPO/apps/api' && npm run db:seed" \
      || die "db:seed не удалось после ${DEPLOY_DB_SEED_RETRIES} попыток"
  else
    log "пропуск db:seed (DEPLOY_DB_SEED=0)"
  fi
}

# S3/CDN для загрузки картинок (админка, POST …/media/*). Работает и при DEPLOY_SKIP_ENV_SECURITY=1.
sync_media_env_from_deploy() {
  if [[ "${DEPLOY_MERGE_DEPLOY_ENV_INTO_API:-1}" != "1" ]]; then
    return 0
  fi
  local envf="$REPO/apps/api/.env"
  sync_env_var_into_api_if_missing "$envf" MEDIA_S3_BUCKET
  sync_env_var_into_api_if_missing "$envf" MEDIA_PUBLIC_BASE_URL
  sync_env_var_into_api_if_missing "$envf" MEDIA_S3_REGION
  sync_env_var_into_api_if_missing "$envf" MEDIA_S3_ENDPOINT
  sync_env_var_into_api_if_missing "$envf" MEDIA_S3_FORCE_PATH_STYLE
  sync_env_var_into_api_if_missing "$envf" AWS_ACCESS_KEY_ID
  sync_env_var_into_api_if_missing "$envf" AWS_SECRET_ACCESS_KEY
}

# Не блокирует деплой: медиа опционально (без ключей API отдаёт 503 на загрузку картинок).
log_media_pipeline_status() {
  local envf="$REPO/apps/api/.env"
  local b pub ak sk
  b="$(read_kv_from_envfile "$envf" MEDIA_S3_BUCKET)"
  pub="$(read_kv_from_envfile "$envf" MEDIA_PUBLIC_BASE_URL)"
  ak="$(read_kv_from_envfile "$envf" AWS_ACCESS_KEY_ID)"
  sk="$(read_kv_from_envfile "$envf" AWS_SECRET_ACCESS_KEY)"
  if [[ -n "${b// }" && -n "${pub// }" && -n "${ak// }" && -n "${sk// }" ]]; then
    log "медиа-пайплайн: MEDIA_* и AWS_* в $envf заданы — загрузка изображений из админки / API включена"
  else
    log "медиа-пайплайн: не заданы MEDIA_S3_BUCKET / MEDIA_PUBLIC_BASE_URL / AWS ключи — см. deploy/IMAGES.md и export в deploy/deploy.env"
  fi
}

post_deploy_smoke_checks() {
  log "проверка health API"
  run_with_retries "$DEPLOY_HEALTH_RETRIES" "$DEPLOY_HEALTH_RETRY_DELAY" curl -fsS "http://127.0.0.1:3001/health" >/dev/null \
    || die "API /health недоступен после перезапуска"

  log "проверка публичного API /api/v1/home/public"
  run_with_retries "$DEPLOY_HEALTH_RETRIES" "$DEPLOY_HEALTH_RETRY_DELAY" curl -fsS "http://127.0.0.1:3001/api/v1/home/public" >/dev/null \
    || die "API /api/v1/home/public недоступен после перезапуска"
}

main() {
  require_cmd git
  require_cmd npm
  require_cmd node
  require_cmd curl
  assert_repo
  cd "$REPO"

  if [[ -f "$REPO/deploy/deploy.env" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "$REPO/deploy/deploy.env"
    set +a
    log "загружен $REPO/deploy/deploy.env"
  fi

  assert_required_env_vars_core
  assert_api_scripts
  assert_telegram_bot_token_in_api_env

  log "git pull --ff-only"
  git pull --ff-only

  # После pull: актуальный docker-compose.yml (порты, образы).
  ensure_infra

  log "npm ci"
  npm ci

  ensure_vapid_in_api_env
  configure_telegram_for_deploy
  ensure_api_env_security_defaults
  sync_media_env_from_deploy
  log_media_pipeline_status
  assert_required_env_vars_production

  log "npm run build (api + web + admin)"
  npm run build

  run_db_sync

  log "права на dist и .env"
  if [[ -d "$REPO/apps/api/assets" ]]; then
    $SUDO chmod -R o+rX "$REPO/apps/api/assets"
  fi
  $SUDO chmod -R o+rX "$REPO/apps/api/dist" "$REPO/apps/web/dist" "$REPO/apps/admin/dist"
  $SUDO chown root:www-data "$REPO/apps/api/.env"
  $SUDO chmod 640 "$REPO/apps/api/.env"

  install_and_restart_mlaffon_systemd

  reload_caddy_if_requested

  post_deploy_smoke_checks

  echo ""
  log "готово"
  curl -sS "http://127.0.0.1:3001/health" || true
  echo ""
  show_mlaffon_units_status
  $SUDO systemctl is-active caddy 2>/dev/null || true
}

main "$@"
