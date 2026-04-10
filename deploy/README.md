Файлы для продакшена на VPS (`REPO=/opt/mlaffon/mlaffon-tg-app`):

| Файл | Назначение |
|------|------------|
| [Caddyfile](Caddyfile) | HTTPS **автоматически** (Caddy + Let’s Encrypt), статика, `/api` |
| [Caddyfile.manual-certs](Caddyfile.manual-certs) | Тот же сайт, но **свои** `fullchain.pem` / `privkey.pem` (уже выданные сертификаты) |
| [mlaffon-api.service](mlaffon-api.service) | systemd: API |
| [mlaffon-worker.service](mlaffon-worker.service) | systemd: основной BullMQ worker (outbox, domain-timers, task-verify, cron) |
| [mlaffon-worker-fraud.service](mlaffon-worker-fraud.service) | systemd: только очередь `fraud-review` (опционально) |
| [redeploy.sh](redeploy.sh) | **Деплой**: `git pull`, `docker compose`, `npm ci`, **`VAPID_*`**, Telegram как ниже, **`CORS`/security env** (см. ниже), **`npm run build`**, `db:push` + `db:seed` (retry), `chmod`, **автоматически**: копирование `deploy/mlaffon-*.service` → `/etc/systemd/system/`, `daemon-reload`, **`systemctl enable` + `restart`** для api, worker и worker-fraud, smoke `/health` и `/api/v1/home/public` |
| [deploy.env.example](deploy.env.example) | Пример `deploy/deploy.env`: `VITE_*`, домены (`PUBLIC_WEB_URL` / `CORS_*`), флаги деплоя |

**Админка не логинится:** в `apps/api/.env` должны быть заданы `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_PASSPHRASE` (без них API отвечает 503). После правки `.env`: `sudo systemctl restart mlaffon-api`. Сборка админки шлёт запросы на `/api` **того же хоста** `admin.…` (Caddy проксирует на API) — отдельный `VITE_API_ORIGIN` на проде для поддомена не обязателен.

### Браузер: `ERR_SSL_PROTOCOL_ERROR` / «This site can’t provide a secure connection» на `admin.*`

Это значит, что с **HTTPS** (порт **443**) приходит **не TLS**: другой процесс слушает 443, или Caddy **не** обслуживает этот поддомен (старый конфиг без блока `admin.mlaffon.fun`).

На сервере по шагам:

1. **DNS** — `admin.mlaffon.fun` должен указывать **на тот же IP**, что и основной домен (запись **A**, не только у `www`):
   ```bash
   dig +short admin.mlaffon.fun A
   dig +short mlaffon.fun A
   ```
   Должны совпасть с IP VPS.

2. **Конфиг Caddy** — в **`/etc/caddy/Caddyfile`** обязательно есть блок **`admin.mlaffon.fun { ... }`** (как в репозитории `deploy/Caddyfile`). Если деплоили только старый файл с одним `mlaffon.fun`, поддомен **не** получит HTTPS:
   ```bash
   sudo grep -n admin /etc/caddy/Caddyfile
   sudo cp /opt/mlaffon/mlaffon-tg-app/deploy/Caddyfile /etc/caddy/Caddyfile
   sudo caddy fmt --overwrite /etc/caddy/Caddyfile
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

3. **Кто слушает 443** — должен быть **caddy**, не nginx/apache на голом HTTP:
   ```bash
   sudo ss -tlnp | grep ':443'
   ```
   Если на 443 **nginx** — остановите его для этого сервера или перенесите TLS на Caddy (см. SIMPLE-START: один веб-сервер на 80/443).

4. **Статус Caddy**:
   ```bash
   sudo systemctl status caddy --no-pager
   sudo journalctl -u caddy -n 40 --no-pager
   ```
   Ошибки ACME часто видны здесь (DNS не тот, порт 80 занят, rate limit Let’s Encrypt).

5. **Проверка с VPS**:
   ```bash
   curl -sI --max-time 10 https://admin.mlaffon.fun/ | head -5
   curl -sI --max-time 10 https://mlaffon.fun/ | head -5
   ```

Если используете **Cloudflare** «оранжевое облако» — иногда мешает выдаче/проверке сертификата на origin; для отладки временно выключите прокси (DNS only) или настройте SSL mode на Full (strict).

Пошаговая инструкция: **[../docs/SIMPLE-START.md](../docs/SIMPLE-START.md)**.

### Полезные флаги для `redeploy.sh`

- `DEPLOY_SKIP_DB=1` — пропустить `db:push`
- `DEPLOY_DB_SEED=0` — пропустить `db:seed` (по умолчанию `db:seed` выполняется)
- `DEPLOY_SKIP_INFRA=1` — не запускать `docker compose up -d postgres redis`
- `DEPLOY_DB_RETRIES=5` и `DEPLOY_DB_RETRY_DELAY=3` — retry для `db:push`
- `DEPLOY_DB_SEED_RETRIES=3` и `DEPLOY_DB_SEED_RETRY_DELAY=3` — retry для `db:seed`
- `DEPLOY_CADDY=1` — обновить `/etc/caddy/Caddyfile` и reload Caddy
- `DEPLOY_SYSTEMD_DAEMON_RELOAD=1` — выполнить `systemctl daemon-reload` перед restart сервисов
- `DEPLOY_SKIP_SYSTEMD_COPY=1` — не перезаписывать unit-файлы из репо (если правите их вручную на сервере)
- `DEPLOY_SKIP_WORKER_FRAUD=1` — не копировать/не включать/не перезапускать `mlaffon-worker-fraud`
- `DEPLOY_TELEGRAM_WEBHOOK_SECRET=1` — сгенерировать/записать `TELEGRAM_WEBHOOK_SECRET` в `apps/api/.env`, если его ещё нет (вебхук)
- `TELEGRAM_WEBHOOK_SECRET` в `deploy/deploy.env` — тот же эффект: значение попадёт в `apps/api/.env` при каждом деплое
- `DEPLOY_SKIP_TELEGRAM_CHECK=1` — не требовать непустой `TELEGRAM_BOT_TOKEN` в `apps/api/.env`
- **`DEPLOY_MERGE_DEPLOY_ENV_INTO_API=1`** (по умолчанию) — пустые `NODE_ENV`, `PUBLIC_WEB_URL`, `PUBLIC_ADMIN_URL`, `CORS_ORIGINS` в `apps/api/.env` дополняются из `export` в `deploy/deploy.env`
- **`DEPLOY_SKIP_ENV_SECURITY=1`** — не дописывать дефолты WS/auth и не генерировать `CORS_ORIGINS` из `PUBLIC_WEB_URL`
- **`DEPLOY_ASSUME_PRODUCTION_API=1`** — если в `apps/api/.env` нет `NODE_ENV`, дописать `production`
- **`DEPLOY_CORS_AUTO_ADMIN=1`** (по умолчанию) — при автогенерации CORS добавить `https://admin.<хост>` от `PUBLIC_WEB_URL`, если нет `PUBLIC_ADMIN_URL`
- **`DEPLOY_AUTO_PRODUCTION_CORS=1`** (по умолчанию) — если удалось вывести продакшен-`https://` домен для CORS, а `NODE_ENV` ещё не `production`, скрипт допишет `NODE_ENV=production`. Отключить: `DEPLOY_AUTO_PRODUCTION_CORS=0`
- **Источник домена для CORS** (первый подходящий `https://` не localhost): `PUBLIC_WEB_URL` → `MINI_APP_WEB_URL` → origin из `TWITCH_REDIRECT_URI` → из `KICK_REDIRECT_URI`
