#!/usr/bin/env bash
#
# Продовый redeploy:
# git pull -> (docker compose up postgres/redis + wait health) -> npm ci -> build
# -> db push (retry) -> chmod/rights -> restart systemd API/worker -> health checks.
#
# Использование:
#   chmod +x deploy/redeploy.sh
#   ./deploy/redeploy.sh
#
# Переменные окружения:
#   REPO=/opt/mlaffon/mlaffon-tg-app
#   DEPLOY_SKIP_DB=1           # не выполнять db:push
#   DEPLOY_DB_SEED=0           # НЕ выполнять db:seed (по умолчанию seed включён)
#   DEPLOY_SKIP_INFRA=1        # не запускать docker compose postgres/redis
#   DEPLOY_CADDY=1             # обновить /etc/caddy/Caddyfile и reload
#   DEPLOY_DB_RETRIES=5        # кол-во retry для db:push
#   DEPLOY_DB_RETRY_DELAY=3    # сек между retry
#   DEPLOY_DB_SEED_RETRIES=3   # retry для db:seed
#   DEPLOY_DB_SEED_RETRY_DELAY=3
#   DEPLOY_SYSTEMD_DAEMON_RELOAD=1  # перед restart выполнить daemon-reload
#   DEPLOY_TELEGRAM_WEBHOOK_SECRET=1 # сгенерировать TELEGRAM_WEBHOOK_SECRET в apps/api/.env, если пусто
#   TELEGRAM_WEBHOOK_SECRET=...      # в deploy.env — записать в apps/api/.env (вебхук)
#   DEPLOY_SKIP_TELEGRAM_CHECK=1     # не проверять TELEGRAM_BOT_TOKEN в apps/api/.env
#
# Web Push: после npm ci скрипт дописывает VAPID_* в apps/api/.env.
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

assert_required_env_vars() {
  local envf="$REPO/apps/api/.env"
  grep -qE '^DATABASE_URL=' "$envf" || die "В $envf отсутствует DATABASE_URL"
  grep -qE '^REDIS_URL=' "$envf" || die "В $envf отсутствует REDIS_URL"
}

assert_api_scripts() {
  local pkg="$REPO/apps/api/package.json"
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const s = p && p.scripts ? p.scripts : {};
    const miss = ['build','db:push','db:seed'].filter((k) => typeof s[k] !== 'string');
    if (miss.length) {
      console.error('missing scripts in apps/api/package.json:', miss.join(', '));
      process.exit(1);
    }
  " "$pkg" || die "Проверьте scripts в $pkg (нужны build, db:push, db:seed)"
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

run_db_sync() {
  if [[ "${DEPLOY_SKIP_DB:-0}" == "1" ]]; then
    log "пропуск db:push (DEPLOY_SKIP_DB=1)"
    return 0
  fi
  log "db:push (apps/api) с retry=${DEPLOY_DB_RETRIES}"
  run_with_retries "$DEPLOY_DB_RETRIES" "$DEPLOY_DB_RETRY_DELAY" bash -lc "cd '$REPO/apps/api' && npm run db:push" \
    || die "db:push не удалось после ${DEPLOY_DB_RETRIES} попыток"

  if [[ "$DEPLOY_DB_SEED" != "0" ]]; then
    log "db:seed (apps/api) с retry=${DEPLOY_DB_SEED_RETRIES}"
    run_with_retries "$DEPLOY_DB_SEED_RETRIES" "$DEPLOY_DB_SEED_RETRY_DELAY" bash -lc "cd '$REPO/apps/api' && npm run db:seed" \
      || die "db:seed не удалось после ${DEPLOY_DB_SEED_RETRIES} попыток"
  else
    log "пропуск db:seed (DEPLOY_DB_SEED=0)"
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

  assert_required_env_vars
  assert_api_scripts
  assert_telegram_bot_token_in_api_env
  ensure_infra

  log "git pull --ff-only"
  git pull --ff-only

  log "npm ci"
  npm ci

  ensure_vapid_in_api_env
  configure_telegram_for_deploy

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

  systemd_reload_if_requested

  log "systemctl restart mlaffon-api mlaffon-worker"
  $SUDO systemctl restart mlaffon-api mlaffon-worker

  reload_caddy_if_requested

  post_deploy_smoke_checks

  echo ""
  log "готово"
  curl -sS "http://127.0.0.1:3001/health" || true
  echo ""
  $SUDO systemctl is-active mlaffon-api mlaffon-worker caddy 2>/dev/null || true
}

main "$@"
