# Деплой на VPS

Основной вариант: код в **Git** (GitHub / GitLab и т.д.), на сервере **`git clone` / `git pull`**, сборка **`npm run build` прямо на VPS**, **Docker** только для **Postgres и Redis**, **Node** на хосте для API и воркера, **Nginx** — статика и прокси `/api`.

`apps/api/.env` в репозиторий **не коммитьте** — создайте на сервере вручную или один раз скопируйте через `scp`.

---

## Через Git: первый деплой

### 1. Репозиторий

Залейте проект в удалённый репозиторий (лучше **приватный**). На сервере клонируйте, например в `/opt/mlaffon`:

```bash
cd /opt
sudo git clone https://github.com/ВАШ_АКК/mlaffon-tg-app.git mlaffon
sudo chown -R $USER:$USER /opt/mlaffon
cd /opt/mlaffon
# или SSH: git@github.com:ВАШ_АКК/mlaffon-tg-app.git
```

### 2. Один раз: система, Docker, Node, UFW, каталог под статику

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

```bash
sudo mkdir -p /var/www/mlaffon/web
sudo chown -R www-data:www-data /var/www/mlaffon
```

### 3. `apps/api/.env` на сервере

```bash
nano /opt/mlaffon/apps/api/.env
```

Скопируйте структуру из корневого `.env.example`, задайте прод-значения (`DATABASE_URL`, `REDIS_URL`, Telegram, секреты, **`ALLOW_DEV_AUTH` не `1`**, `PUBLIC_WEB_URL=https://ваш-домен`, OAuth redirect **https**). Права:

```bash
sudo chown root:www-data /opt/mlaffon/apps/api/.env
sudo chmod 640 /opt/mlaffon/apps/api/.env
```

### 4. Postgres и Redis (Docker)

В `docker-compose.yml` задайте пароль БД и порты **127.0.0.1** наружу не открывайте. `DATABASE_URL` в `.env` должен совпадать.

```bash
cd /opt/mlaffon
docker compose up -d
```

### 5. Сборка и база

```bash
cd /opt/mlaffon
npm ci
export VITE_BOT_USERNAME=YourBotName
npm run build
cd apps/api
npx drizzle-kit push
npm run db:seed
```

### 6. Статика, systemd, Nginx

```bash
sudo cp -r /opt/mlaffon/apps/web/dist/* /var/www/mlaffon/web/
sudo chown -R www-data:www-data /var/www/mlaffon/web
```

Подключите юниты из раздела [Systemd](#systemd-api-и-воркер), конфиг [Nginx](#nginx-https--статика--api), выпустите сертификат **certbot**. В `apps/api/.env` задайте **`PORT=3001`**.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mlaffon-api mlaffon-worker
sudo nginx -t && sudo systemctl reload nginx
```

---

## Обновление через Git

На сервере:

```bash
cd /opt/mlaffon
git pull
npm ci
export VITE_BOT_USERNAME=YourBotName
npm run build
cd apps/api && npx drizzle-kit push
cd /opt/mlaffon
sudo cp -r apps/web/dist/* /var/www/mlaffon/web/
sudo systemctl restart mlaffon-api mlaffon-worker
```

`db:seed` при обновлении обычно не нужен (только при первой установке или осознанно).

---

## Что где крутится

| Где | Что |
|-----|-----|
| **Docker** | **Postgres** и **Redis** (`docker compose`). |
| **Node на хосте** | Собранные `apps/api/dist` — API и воркер (**systemd**). |
| **Nginx** | Статика из `apps/web/dist` и **прокси** `/api` → `127.0.0.1:3001`. |

Отдельного Docker-образа приложения в репо нет — при желании позже можно добавить `Dockerfile` и заменить systemd.

---

## Альтернатива: без Git, архивом с ПК

Если не хотите клонировать на сервер: на ПК `npm ci`, `npm run build`, упакуйте проект в `tar`, перешлите `scp`, на сервере распакуйте в `/opt/mlaffon`, положите `.env`, дальше как выше (Docker, копирование `dist`, systemd, Nginx). См. также перенос схемы БД через SSH-туннель с ПК, если не гоняете `drizzle-kit` на сервере.

---

## Systemd: API и воркер

`which node` — подставьте в `ExecStart` (часто `/usr/bin/node`).

`/etc/systemd/system/mlaffon-api.service`:

```ini
[Unit]
Description=Mlaffon API
After=network.target docker.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/mlaffon/apps/api
EnvironmentFile=/opt/mlaffon/apps/api/.env
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
WorkingDirectory=/opt/mlaffon/apps/api
EnvironmentFile=/opt/mlaffon/apps/api/.env
ExecStart=/usr/bin/node dist/worker.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Права:

```bash
sudo chmod o+x /opt /opt/mlaffon /opt/mlaffon/apps /opt/mlaffon/apps/api
sudo chmod -R o+rX /opt/mlaffon/apps/api/dist
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

    root /var/www/mlaffon/web;
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
- Воркер в systemd, если нужны задания с проверкой через API.

---

## Дополнительно

- Один домен для фронта и `/api` — проще всего.
- Postgres/Redis наружу не публиковать, бэкапы БД.
