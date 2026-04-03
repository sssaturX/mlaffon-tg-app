#!/usr/bin/env bash
#
# Один прогон на VPS: git pull → сборка → (БД) → права → restart API/worker.
# Репозиторий по умолчанию как в docs/SIMPLE-START.md
#
# Использование:
#   chmod +x deploy/redeploy.sh
#   ./deploy/redeploy.sh
# или из корня репо:
#   bash deploy/redeploy.sh
#
# От root или через sudo — для chmod и systemctl. Если не root:
#   sudo env REPO=/opt/mlaffon/mlaffon-tg-app ./deploy/redeploy.sh
#
# Опционально перед сборкой (Vite): скопируйте deploy/deploy.env.example → deploy/deploy.env
# и задайте VITE_BOT_USERNAME и др.
#
# Переменные окружения:
#   REPO          — корень репозитория (по умолчанию /opt/mlaffon/mlaffon-tg-app)
#   DEPLOY_SKIP_DB=1  — не вызывать drizzle-kit push
#   DEPLOY_CADDY=1    — скопировать deploy/Caddyfile в /etc/caddy и reload caddy
#
# Web Push: после npm ci скрипт дописывает в apps/api/.env:
#   VAPID_SUBJECT (по умолчанию mailto:itoly569@gmail.com)
#   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — из deploy/deploy.env, либо уже в .env, либо генерируются (web-push).
#

set -euo pipefail

REPO="${REPO:-/opt/mlaffon/mlaffon-tg-app}"

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
fi

if [[ ! -d "$REPO" ]]; then
  echo "Нет каталога REPO=$REPO — задайте путь: REPO=/path/to/mlaffon-tg-app $0" >&2
  exit 1
fi

if [[ ! -f "$REPO/package.json" ]]; then
  echo "В $REPO нет package.json — это не корень монорепо." >&2
  exit 1
fi

# Дописать VAPID в apps/api/.env (нужен npm ci для web-push в node_modules).
ensure_vapid_in_api_env() {
  local envf="$REPO/apps/api/.env"
  local subject="${VAPID_SUBJECT:-mailto:itoly569@gmail.com}"
  local pub="${VAPID_PUBLIC_KEY:-}"
  local priv="${VAPID_PRIVATE_KEY:-}"

  if [[ ! -f "$envf" ]]; then
    echo "==> предупреждение: нет $envf — VAPID не добавлены" >&2
    return 0
  fi

  if [[ -z "$pub" || -z "$priv" ]]; then
    if grep -qE '^VAPID_PUBLIC_KEY=' "$envf" && grep -qE '^VAPID_PRIVATE_KEY=' "$envf"; then
      echo "==> VAPID ключи уже есть в $envf — обновляю только subject при необходимости"
      pub=$(grep -E '^VAPID_PUBLIC_KEY=' "$envf" | tail -1 | sed 's/^VAPID_PUBLIC_KEY=//')
      priv=$(grep -E '^VAPID_PRIVATE_KEY=' "$envf" | tail -1 | sed 's/^VAPID_PRIVATE_KEY=//')
    else
      echo "==> генерация VAPID ключей (web-push) → $envf"
      local keys
      keys=$(
        cd "$REPO/apps/api" && node -e "
          const w = require('web-push');
          const k = w.generateVAPIDKeys();
          console.log(k.publicKey);
          console.log(k.privateKey);
        "
      )
      pub=$(printf '%s\n' "$keys" | head -n1)
      priv=$(printf '%s\n' "$keys" | tail -n1)
    fi
  else
    echo "==> VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY из окружения (deploy.env) → $envf"
  fi

  local tmp
  tmp=$(mktemp)
  grep -vE '^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=' "$envf" >"$tmp" || true
  {
    cat "$tmp"
    echo "VAPID_SUBJECT=${subject}"
    echo "VAPID_PUBLIC_KEY=${pub}"
    echo "VAPID_PRIVATE_KEY=${priv}"
  } >"${envf}.new"
  mv "${envf}.new" "$envf"
  rm -f "$tmp"
  echo "==> обновлены VAPID_* в $envf (SUBJECT=${subject})"
}

cd "$REPO"

if [[ -f "$REPO/deploy/deploy.env" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$REPO/deploy/deploy.env"
  set +a
  echo "==> загружен $REPO/deploy/deploy.env"
fi

echo "==> git pull ($REPO)"
git pull --ff-only

echo "==> npm ci"
npm ci

ensure_vapid_in_api_env

echo "==> npm run build (api + web + admin)"
npm run build

if [[ "${DEPLOY_SKIP_DB:-0}" != "1" ]]; then
  echo "==> drizzle-kit push (apps/api)"
  (cd apps/api && npx drizzle-kit push)
else
  echo "==> пропуск БД (DEPLOY_SKIP_DB=1)"
fi

echo "==> chmod o+rX dist"
$SUDO chmod -R o+rX "$REPO/apps/api/dist" "$REPO/apps/web/dist" "$REPO/apps/admin/dist"

echo "==> systemctl restart mlaffon-api mlaffon-worker"
$SUDO systemctl restart mlaffon-api mlaffon-worker

if [[ "${DEPLOY_CADDY:-0}" == "1" ]]; then
  echo "==> Caddy: копируем Caddyfile и reload"
  $SUDO cp "$REPO/deploy/Caddyfile" /etc/caddy/Caddyfile
  $SUDO caddy fmt --overwrite /etc/caddy/Caddyfile
  $SUDO caddy validate --config /etc/caddy/Caddyfile
  $SUDO systemctl reload caddy
fi

echo ""
echo "==> готово. Проверка:"
curl -sS "http://127.0.0.1:3001/health" || true
echo ""
$SUDO systemctl is-active mlaffon-api mlaffon-worker caddy 2>/dev/null || true
