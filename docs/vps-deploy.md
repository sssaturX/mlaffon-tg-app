# Деплой на VPS: `scp`, настройка сервера, Nginx, systemd

Схема: **Nginx** (HTTPS + статика фронта + прокси `/api` → Node), **Docker Compose** только для **Postgres и Redis**, на хосте **Node.js 20+**, **systemd** для API и воркера.

Домен `app.example.com` замените на свой. Запросы к API идут на **`/api/...`** с того же домена (как в разработке).

---

## 0. Что сделать на своём компьютере (перед `scp`)

1. Соберите проект локально (или соберёте уже на сервере — тогда на VPS нужен Node):

   ```bash
   cd mlaffon-tg-app
   npm ci
   export VITE_BOT_USERNAME=YourBotName
   npm run build
   ```

2. Файл **`apps/api/.env`** с прод-секретами **не кладите в git**. Его удобно положить на сервер **отдельной командой `scp`** (см. ниже).

3. Убедитесь, что есть **SSH-доступ** к VPS по ключу или паролю:

   ```bash
   ssh-copy-id deploy@СЕРВЕР_IP
   ```

   Дальше в примерах пользователь на сервере — `deploy`, IP — `СЕРВЕР_IP`, путь проекта — `/opt/mlaffon`.

---

## 1. Первый заход на VPS (пользователь, SSH, фаервол)

Подключитесь:

```bash
ssh deploy@СЕРВЕР_IP
```

Создайте пользователя для деплоя (если ещё только `root`):

```bash
sudo adduser deploy
sudo usermod -aG sudo deploy
```

На своём ПК скопируйте ключ:

```bash
ssh-copy-id deploy@СЕРВЕР_IP
```

**UFW** (открыть только SSH, HTTP, HTTPS; Postgres/Redis снаружи не торчат):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

DNS: **A-запись** домена на IP VPS. Минимум **1–2 GB RAM**.

---

## 2. Пакеты на сервере

```bash
sudo apt install -y git curl nginx certbot python3-certbot-nginx
```

**Node.js 20+** — например через [NodeSource](https://github.com/nodesource/distributions):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

**Docker + Compose** — по [официальной инструкции](https://docs.docker.com/engine/install/ubuntu/), затем:

```bash
sudo usermod -aG docker deploy
# выйти из SSH и зайти снова, чтобы подхватилась группа docker
```

---

## 3. Каталог на сервере под проект

```bash
sudo mkdir -p /opt/mlaffon
sudo chown deploy:deploy /opt/mlaffon
```

Статика для Nginx:

```bash
sudo mkdir -p /var/www/mlaffon/web
sudo chown -R www-data:www-data /var/www/mlaffon
```

---

## 4. Перенос кода на сервер: `scp` и `rsync`

### Вариант A — архив и `scp` (удобно для первого раза)

На **своём ПК** (из родительской папки репозитория):

```bash
cd /путь/к
tar czf mlaffon.tar.gz mlaffon-tg-app
scp mlaffon.tar.gz deploy@СЕРВЕР_IP:/tmp/
```

На **сервере**:

```bash
cd /opt
tar xzf /tmp/mlaffon.tar.gz
mv mlaffon-tg-app mlaffon
rm /tmp/mlaffon.tar.gz
cd /opt/mlaffon
```

Если архивировали **без** `node_modules` (рекомендуется), на сервере:

```bash
npm ci
```

### Вариант B — папка целиком через `scp -r`

На **своём ПК**:

```bash
scp -r ./mlaffon-tg-app deploy@СЕРВЕР_IP:/opt/mlaffon
```

Убедитесь, что не тянете гигабайты **`node_modules`** (лучше удалить на ПК перед копированием или использовать вариант A без них).

### Вариант C — `rsync` (обновления без полного архива)

Исключаем `node_modules` и `.git`:

```bash
rsync -avz --delete \
  --exclude node_modules \
  --exclude '.git' \
  --exclude apps/web/dist \
  --exclude apps/api/dist \
  ./mlaffon-tg-app/ deploy@СЕРВЕР_IP:/opt/mlaffon/
```

После `rsync` на сервере: `npm ci`, `npm run build` и т.д.

### Отдельно: только `apps/api/.env`

**С локальной машины** (файл с секретами не в репозитории):

```bash
scp apps/api/.env deploy@СЕРВЕР_IP:/opt/mlaffon/apps/api/.env
```

На сервере ограничьте права:

```bash
sudo chown root:www-data /opt/mlaffon/apps/api/.env
sudo chmod 640 /opt/mlaffon/apps/api/.env
```

(`systemd` ниже запускает процессы от `www-data` и читает `EnvironmentFile`.)

### Обновить только фронт после сборки на ПК

```bash
scp -r apps/web/dist/* deploy@СЕРВЕР_IP:/var/www/mlaffon/web/
```

---

## 5. `docker-compose.yml`: Postgres и Redis только на localhost

В корне репозитория откройте `docker-compose.yml` и для прода задайте **свой пароль** Postgres и при необходимости порты **только на 127.0.0.1**:

```yaml
ports:
  - "127.0.0.1:5432:5432"
```

Аналогично Redis: `127.0.0.1:6379:6379`.

На сервере:

```bash
cd /opt/mlaffon
docker compose up -d
docker compose ps
```

Строка **`DATABASE_URL`** в `apps/api/.env` должна совпадать с пользователем/паролем/именем БД из compose.

---

## 6. Сборка на сервере и база данных

Если код приехал без `node_modules` или после правок:

```bash
cd /opt/mlaffon
npm ci
export VITE_BOT_USERNAME=YourBotName
npm run build
```

Заполните **`apps/api/.env`** (через `nano` или `scp`, см. `.env.example`):  
`DATABASE_URL`, `REDIS_URL`, Telegram, `JWT_SECRET`, `TOKENS_ENCRYPTION_KEY`, **`ALLOW_DEV_AUTH` не `1`**, `PUBLIC_WEB_URL=https://app.example.com`, OAuth redirect URI **HTTPS** на ваш домен, например:

`https://app.example.com/api/v1/oauth/twitch/callback`

Применение схемы и сиды:

```bash
cd /opt/mlaffon/apps/api
npx drizzle-kit push
npm run db:seed
cd /opt/mlaffon
```

Копирование статики:

```bash
sudo cp -r /opt/mlaffon/apps/web/dist/* /var/www/mlaffon/web/
sudo chown -R www-data:www-data /var/www/mlaffon/web
```

---

## 7. Systemd: API и воркер

Проверьте путь к Node: `which node` (часто `/usr/bin/node`). В `ExecStart` подставьте его.

Файл `/etc/systemd/system/mlaffon-api.service`:

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

Файл `/etc/systemd/system/mlaffon-worker.service`:

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

`www-data` должен иметь право **читать** цепочку каталогов до `/opt/mlaffon/apps/api` и файлы `dist/*.js`. Проще всего:

```bash
sudo chmod o+x /opt /opt/mlaffon /opt/mlaffon/apps /opt/mlaffon/apps/api
sudo chmod -R o+rX /opt/mlaffon/apps/api/dist
```

Активация:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mlaffon-api mlaffon-worker
sudo systemctl status mlaffon-api mlaffon-worker
```

В `apps/api/.env` для API задайте **`PORT=3001`** (или тот порт, что в `proxy_pass` ниже).

---

## 8. Nginx: статика + прокси `/api`

Создайте `/etc/nginx/sites-available/mlaffon` (замените `app.example.com`):

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

Первый выпуск сертификата (если SSL ещё нет) — можно временно использовать только блок `listen 80` без редиректа на HTTPS, либо:

```bash
sudo certbot certonly --nginx -d app.example.com
```

После появления файлов в `/etc/letsencrypt/live/...` подключите полный конфиг с `ssl_certificate`, затем:

```bash
sudo ln -sf /etc/nginx/sites-available/mlaffon /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

В **BotFather** URL Mini App: `https://app.example.com` (как `PUBLIC_WEB_URL`).

---

## 9. Чеклист переменных продакшена

- `ALLOW_DEV_AUTH` — не включать.
- `PUBLIC_WEB_URL=https://app.example.com`
- OAuth redirect URI в Twitch/Kick = **точно** как в `.env`, с `https://`.
- `VITE_BOT_USERNAME` задан при **`npm run build -w web`**.
- Воркер запущен, если нужны задания с проверкой через API (`npm run worker` → unit `mlaffon-worker`).

---

## 10. Обновление (git на сервере или снова `scp`/`rsync`)

**Если клонировали репозиторий на VPS:**

```bash
cd /opt/mlaffon
git pull
npm ci
export VITE_BOT_USERNAME=YourBotName
npm run build
cd apps/api && npx drizzle-kit push && cd /opt/mlaffon
sudo cp -r apps/web/dist/* /var/www/mlaffon/web/
sudo systemctl restart mlaffon-api mlaffon-worker
```

**Если обновляете с ноутбука через `rsync`:** синхронизируйте код, затем на сервере снова `npm ci`, `npm run build`, копирование `dist`, `restart` сервисов.

---

## 11. Если API на другом поддомене

Сейчас фронт обращается к **`/api`** на том же origin. Удобнее один домен и Nginx как выше. Иначе потребуется отдельная доработка фронта (базовый URL API).

---

## 12. Безопасность

- Не публиковать Postgres/Redis в интернет.
- Сильные `JWT_SECRET`, `TOKENS_ENCRYPTION_KEY`, пароль БД.
- Регулярные `apt upgrade`, бэкапы БД.
