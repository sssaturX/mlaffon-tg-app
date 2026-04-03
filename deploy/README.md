Файлы для продакшена на VPS (`REPO=/opt/mlaffon/mlaffon-tg-app`):

| Файл | Назначение |
|------|------------|
| [Caddyfile](Caddyfile) | HTTPS **автоматически** (Caddy + Let’s Encrypt), статика, `/api` |
| [Caddyfile.manual-certs](Caddyfile.manual-certs) | Тот же сайт, но **свои** `fullchain.pem` / `privkey.pem` (уже выданные сертификаты) |
| [mlaffon-api.service](mlaffon-api.service) | systemd: API |
| [mlaffon-worker.service](mlaffon-worker.service) | systemd: BullMQ worker |
| [redeploy.sh](redeploy.sh) | **Быстрый деплой на сервере**: `git pull`, `npm ci`, **дописывает `VAPID_*` в `apps/api/.env`** (subject по умолчанию `mailto:itoly569@gmail.com`, ключи из `deploy.env` или уже в `.env`, иначе генерация), сборка, `drizzle-kit push`, `chmod`, restart API/worker |
| [deploy.env.example](deploy.env.example) | Пример `deploy/deploy.env` для `VITE_*` при сборке |

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
