# Деплой на VPS

Если нужен **один короткий чеклист без отвлечений**, начните с **[SIMPLE-START.md](SIMPLE-START.md)**.

Основной вариант: код в **Git**, на сервере **`git clone` / `git pull`**, сборка **`npm run build` на VPS**, **Docker** только для **Postgres и Redis** (один раз `docker compose up -d` — контейнеры крутятся в фоне, отдельный терминал не нужен), **Node** для API и воркера через **systemd** (тоже без ручных терминалов). Статику и HTTPS отдаёт **Nginx** или **[Caddy](caddy-mlaffon.md)** — прокси `/api` → `127.0.0.1:3001`.

**Статика фронта:** отдаётся **напрямую из `apps/web/dist`** внутри каталога репозитория (после `npm run build`). **Не копируем** `dist` в `/var/www` — в конфиге Caddy/Nginx указывается полный путь к `.../apps/web/dist`.

Локально в dev по-прежнему два процесса: `npm run dev` и `npm run worker -w api`. **На проде** вместо этого — **два systemd-юнита** (см. ниже), не несколько SSH-сессий.

`apps/api/.env` в репозиторий **не коммитьте** — создайте на сервере вручную или один раз скопируйте через `scp`.

---

## Через Git: первый деплой

### 1. Репозиторий

Залейте проект в удалённый репозиторий (лучше **приватный**). На сервере клонируйте так, чтобы корень репо был **`/opt/mlaffon/mlaffon-tg-app`** (все пути в гайде и в `deploy/*.service` рассчитаны на это):

```bash
sudo mkdir -p /opt/mlaffon
sudo chown $USER:$USER /opt/mlaffon
cd /opt/mlaffon
git clone https://github.com/ВАШ_АКК/mlaffon-tg-app.git mlaffon-tg-app
cd mlaffon-tg-app
# SSH: git@github.com:ВАШ_АКК/mlaffon-tg-app.git
```

### 2. Один раз: система, Docker, Node, UFW

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git ufw nginx certbot python3-certbot-nginx curl
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

Docker — [установка для Ubuntu](https://docs.docker.com/engine/install/ubuntu/), затем `sudo usermod -aG docker $USER` и перелогин.

Node 20+:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Отдельный каталог под статику **не нужен** — используется `apps/web/dist` в репозитории. После первой сборки выдайте чтение для веб-сервера (Caddy / `www-data`), см. шаг 6.

### 3. `apps/api/.env` на сервере

```bash
nano /opt/mlaffon/mlaffon-tg-app/apps/api/.env
```

Скопируйте структуру из корневого `.env.example`, задайте прод-значения (`DATABASE_URL`, `REDIS_URL`, Telegram, секреты, **`ALLOW_DEV_AUTH` не `1`**, `PUBLIC_WEB_URL=https://ваш-домен`, OAuth redirect **https**). Права:

```bash
sudo chown root:www-data /opt/mlaffon/mlaffon-tg-app/apps/api/.env
sudo chmod 640 /opt/mlaffon/mlaffon-tg-app/apps/api/.env
```

### 4. Postgres и Redis (Docker)

В `docker-compose.yml` задайте пароль БД и порты **127.0.0.1** наружу не открывайте. `DATABASE_URL` в `.env` должен совпадать.

```bash
cd /opt/mlaffon/mlaffon-tg-app
docker compose up -d
```

### 5. Сборка и база

```bash
cd /opt/mlaffon/mlaffon-tg-app
npm ci
export VITE_BOT_USERNAME=YourBotName
npm run build
cd apps/api
npx drizzle-kit push
npm run db:seed
```

### 6. Права на `dist`, systemd, веб-сервер (Nginx или Caddy)

Корень репозитория: **`/opt/mlaffon/mlaffon-tg-app`**.

Чтобы **Caddy** / **Nginx** и пользователь **`www-data`** (systemd) могли читать файлы:

```bash
REPO=/opt/mlaffon/mlaffon-tg-app
sudo chmod o+x $REPO $REPO/apps $REPO/apps/web $REPO/apps/api
sudo chmod -R o+rX $REPO/apps/web/dist
sudo chmod -R o+rX $REPO/apps/api/dist
```

Установите systemd-юниты из репозитория (пути уже под `$REPO`):

```bash
sudo cp $REPO/deploy/mlaffon-api.service /etc/systemd/system/
sudo cp $REPO/deploy/mlaffon-worker.service /etc/systemd/system/
sudo cp $REPO/deploy/mlaffon-worker-fraud.service /etc/systemd/system/
```

Либо скопируйте блоки вручную из раздела [Systemd](#systemd-api-и-воркер). В `apps/api/.env` задайте **`PORT=3001`**. Убедитесь, что **`npm run build` уже выполнен** (есть каталоги `apps/api/dist` и `apps/web/dist`).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mlaffon-api mlaffon-worker mlaffon-worker-fraud
```

`mlaffon-worker-fraud` опционален: без него jobs `fraud-review` копятся в Redis, но основной **worker** (broadcast/outbox, таймеры, задания) обязателен.

**Веб-сервер на выбор:**

- **Nginx** + certbot — конфиг [ниже](#nginx-https--статика--api), затем `sudo nginx -t && sudo systemctl reload nginx`.
- **Caddy** (HTTPS из коробки) — **[deploy/Caddyfile](../deploy/Caddyfile)** с `root` на `.../apps/web/dist`. Подробности: **[docs/caddy-mlaffon.md](caddy-mlaffon.md)**. Не поднимайте одновременно Nginx и Caddy на портах 80/443.

---

## Обновление через Git

На сервере:

```bash
cd /opt/mlaffon/mlaffon-tg-app
git pull
npm ci
export VITE_BOT_USERNAME=YourBotName
npm run build
cd apps/api && npx drizzle-kit push
cd /opt/mlaffon/mlaffon-tg-app
REPO=/opt/mlaffon/mlaffon-tg-app
sudo chmod -R o+rX $REPO/apps/web/dist $REPO/apps/api/dist
sudo systemctl restart mlaffon-api mlaffon-worker mlaffon-worker-fraud
sudo systemctl reload caddy
# или: sudo systemctl reload nginx
```

`db:seed` при обновлении обычно не нужен (только при первой установке или осознанно).

---

## Что где крутится

| Где | Что |
|-----|-----|
| **Docker** | **Postgres** и **Redis** (`docker compose`). |
| **Node на хосте** | Собранные `apps/api/dist` — API, основной worker и при необходимости **worker-fraud** (**systemd**). |
| **Nginx / Caddy** | Статика **напрямую** из `apps/web/dist` (путь в конфиге) и **прокси** `/api` → `127.0.0.1:3001`. |

Отдельного Docker-образа приложения в репо нет — при желании позже можно добавить `Dockerfile` и заменить systemd.

---

## Альтернатива: без Git, архивом с ПК

Если не хотите клонировать на сервер: на ПК `npm ci`, `npm run build`, упакуйте проект в `tar`, перешлите `scp`, на сервере распакуйте, положите `.env`, дальше как выше (Docker, **права на `apps/web/dist`**, systemd, Nginx/Caddy). См. также перенос схемы БД через SSH-туннель с ПК, если не гоняете `drizzle-kit` на сервере.

---

## Systemd: API и воркер

Готовые файлы в репозитории: **[deploy/mlaffon-api.service](../deploy/mlaffon-api.service)**, **[deploy/mlaffon-worker.service](../deploy/mlaffon-worker.service)**, **[deploy/mlaffon-worker-fraud.service](../deploy/mlaffon-worker-fraud.service)** (корень репо **`/opt/mlaffon/mlaffon-tg-app`**). Установка:

```bash
REPO=/opt/mlaffon/mlaffon-tg-app
sudo cp $REPO/deploy/mlaffon-api.service /etc/systemd/system/
sudo cp $REPO/deploy/mlaffon-worker.service /etc/systemd/system/
sudo cp $REPO/deploy/mlaffon-worker-fraud.service /etc/systemd/system/
```

`which node` — при необходимости замените в `ExecStart` (часто `/usr/bin/node`).

`/etc/systemd/system/mlaffon-api.service`:

```ini
[Unit]
Description=Mlaffon API
After=network.target docker.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/mlaffon/mlaffon-tg-app/apps/api
EnvironmentFile=/opt/mlaffon/mlaffon-tg-app/apps/api/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/mlaffon-worker.service`:

```ini
[Unit]
Description=Mlaffon BullMQ worker
After=network.target docker.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/mlaffon/mlaffon-tg-app/apps/api
EnvironmentFile=/opt/mlaffon/mlaffon-tg-app/apps/api/.env
ExecStart=/usr/bin/node dist/worker.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/mlaffon-worker-fraud.service` (только очередь `fraud-review`):

```ini
[Unit]
Description=Mlaffon BullMQ worker (fraud-review queue only)
After=network.target docker.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/mlaffon/mlaffon-tg-app/apps/api
EnvironmentFile=/opt/mlaffon/mlaffon-tg-app/apps/api/.env
ExecStart=/usr/bin/node dist/worker-fraud.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Права на каталоги и `dist` (см. шаг 6 выше):

```bash
REPO=/opt/mlaffon/mlaffon-tg-app
sudo chmod o+x /opt /opt/mlaffon $REPO $REPO/apps $REPO/apps/api $REPO/apps/web
sudo chmod -R o+rX $REPO/apps/api/dist $REPO/apps/web/dist
```

---

## Nginx: HTTPS + статика + `/api`

`/etc/nginx/sites-available/mlaffon` (замените `app.example.com`):

```nginx
server {
    listen 80;
    server_name app.example.com;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    # Корень репозитория на сервере — подставьте свой (пример: /opt/mlaffon/mlaffon-tg-app)
    root /opt/mlaffon/mlaffon-tg-app/apps/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo certbot certonly --nginx -d app.example.com
sudo ln -sf /etc/nginx/sites-available/mlaffon /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## Чеклист продакшена

- `ALLOW_DEV_AUTH` не включать.
- `PUBLIC_WEB_URL=https://ваш-домен`
- OAuth redirect в Twitch/Kick = как в `.env`, **https**.
- `VITE_BOT_USERNAME` задан при **`npm run build`** на сервере.
- **Основной** воркер в systemd обязателен: без него не уходят broadcast-события (outbox → Redis) и не срабатывают delayed jobs (дроп, эфир, предикты, задания).
- **worker-fraud** — по желанию; иначе очередь `fraud-review` накапливается, пока процесс не запущен.

---

## Дополнительно

- Один домен для фронта и `/api` — проще всего.
- Postgres/Redis наружу не публиковать, бэкапы БД.
