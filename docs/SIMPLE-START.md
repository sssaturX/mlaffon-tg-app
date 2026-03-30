# Простой запуск на сервере (всё в одном месте)

**Репозиторий:** `/opt/mlaffon/mlaffon-tg-app`  
**Домены:** основной мини-приложения — `mlaffon.fun`; админка — `**admin.mlaffon.fun`** (отдельный поддомен, тот же API по `/api/*`). В `apps/api/.env`: `PUBLIC_WEB_URL=https://mlaffon.fun`, OAuth redirect на этот домен. Для входа в админку задайте `**ADMIN_EMAIL**`, `**ADMIN_PASSWORD**`, `**ADMIN_PASSPHRASE**` (и при желании `**ADMIN_JWT_SECRET**` или общий `**JWT_SECRET**`).

**Админка запускается тем же сценарием**, что и основной сайт: `npm run build` собирает `apps/admin/dist`, Caddy отдаёт её на `admin.mlaffon.fun`, отдельного systemd для админки нет. Нужны DNS на поддомен (§8), права на `apps/admin/dist` (§6) и `**ADMIN_*`** в `.env` (§2).

**Соответствие «как локально»:**


| Локально                     | На сервере                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docker compose up -d`       | То же                                                                                                  |
| `npm run dev` (API + Vite)   | `npm run build` → API из `dist` + статика из `**apps/web/dist`** + `**apps/admin/dist**`               |
| `npm run worker -w api`      | Отдельный процесс `node dist/worker.js` (через systemd)                                                |
| Браузер → Vite прокси `/api` | **Caddy** отдаёт **два** сайта (`mlaffon.fun` и `admin.mlaffon.fun`) и шлёт `/api` на `127.0.0.1:3001` |


Нужны: **Ubuntu**, **Node.js 20+**, **Docker** + Compose, **Caddy**. Один раз откройте порты **22, 80, 443** (ufw).

---

## 0. Переменные (удобно в шелле)

```bash
export REPO=/opt/mlaffon/mlaffon-tg-app
export VITE_BOT_USERNAME=MlaffonBot
```

`VITE_BOT_USERNAME` — как в Telegram, **без** `@`.

---

## 1. Установка Node, Docker, Caddy

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt update
sudo apt install -y nodejs git curl
node -v
```

Docker — [официальная инструкция](https://docs.docker.com/engine/install/ubuntu/), затем:

```bash
sudo usermod -aG docker $USER
# при необходимости выйдите из SSH и зайдите снова
```

Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Если на сервере стоит **Nginx** и занят порт 80:

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
```

---

## 2. Код и `.env`

Репозиторий уже должен лежать в `$REPO`. Файл `**$REPO/apps/api/.env**` заполните (как в `.env.example` в корне репо): `DATABASE_URL`, `REDIS_URL`, Telegram, секреты, `**PORT=3001**`, `**PUBLIC_WEB_URL=https://mlaffon.fun**`, Twitch/Kick redirect на `https://mlaffon.fun/api/v1/.../callback`.  
Для **админки** (вход на `https://admin.mlaffon.fun`): `**ADMIN_EMAIL`**, `**ADMIN_PASSWORD**`, `**ADMIN_PASSPHRASE**`; для подписи JWT — `**ADMIN_JWT_SECRET**` или общий `**JWT_SECRET**`.  
**Прод:** не включайте `ALLOW_DEV_AUTH=1`.

---

## 3. Postgres и Redis

Из **корня репозитория** (там `docker-compose.yml`):

```bash
cd $REPO
docker compose up -d
docker compose ps
```

Строка `DATABASE_URL` в `.env` должна совпадать с пользователем/паролем/БД из compose.

---

## 4. Сборка (как `npm run build` локально, но один раз на сервере)

```bash
cd $REPO
npm ci
npm run build
```

Должны появиться каталоги `**apps/api/dist**`, `**apps/web/dist**` и `**apps/admin/dist**` (команда `npm run build` в корне собирает API, веб и админку).

---

## 5. Схема БД и сиды

```bash
cd $REPO/apps/api
npx drizzle-kit push
npm run db:seed
cd $REPO
```

---

## 6. Права (чтобы `www-data` и Caddy читали файлы)

```bash
sudo chmod o+x /opt /opt/mlaffon $REPO $REPO/apps $REPO/apps/api $REPO/apps/web $REPO/apps/admin
sudo chmod -R o+rX $REPO/apps/api/dist $REPO/apps/web/dist $REPO/apps/admin/dist
sudo chown root:www-data $REPO/apps/api/.env
sudo chmod 640 $REPO/apps/api/.env
```

---

## 7. API и воркер (systemd)

Как два отдельных терминала с `node`, но в фоне и с автозапуском:

```bash
sudo cp $REPO/deploy/mlaffon-api.service /etc/systemd/system/
sudo cp $REPO/deploy/mlaffon-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mlaffon-api mlaffon-worker
sudo systemctl status mlaffon-api mlaffon-worker --no-pager
```

Проверка API:

```bash
curl -s http://127.0.0.1:3001/health
```

Должно быть: `{"ok":true}`.

Если ошибка **ExecStart**: выполните `which node` и подставьте путь в оба `.service` вместо `/usr/bin/node`.

---

## 8. Caddy (сайт по домену)

**Два варианта TLS:**

### A) Caddy сам получает сертификат (Let's Encrypt) — **основной вариант**

Репозиторийный `**deploy/Caddyfile`** уже без ручных PEM: Caddy сам запрашивает и продлевает сертификат у Let’s Encrypt.

Перед копированием конфига (по желанию): в `**deploy/Caddyfile**` раскомментируйте строку `**email ...**` в глобальном блоке `{ }` — на эту почту ACME пришлёт напоминания о сроке.

Чеклист:

1. В DNS у домена **A** (и при необходимости **AAAA**) на **IP этого VPS** — иначе выпуск не пройдёт.
2. Для **админки** на поддомене: **A** (или **CNAME**) `**admin.mlaffon.fun`** → тот же IP (или на `mlaffon.fun`). Без записи Caddy не сможет выдать TLS для админки.
3. Порты **80** и **443** открыты (ufw / облако); **80** должен слушать **caddy**, не nginx.
4. Если раньше стоял `**Caddyfile.manual-certs`**, вернитесь на обычный файл (команды ниже) **или** допишите второй сайт вручную по аналогии с репозиторием.

```bash
sudo cp $REPO/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager
```

Первый успешный выпуск может занять до минуты; при ошибках смотрите `**journalctl -u caddy -e**`.

### B) Сертификат уже выдан (у регистратора / certbot / не через Caddy)

Файлы `**fullchain.pem**` и `**privkey.pem**` должны **лежать на этом сервере** (скопируйте PEM с хостинга регистратора или скачайте архив). Если сертификат только «в панели» без файлов на VPS — сначала положите PEM в каталог, например `/etc/ssl/mlaffon/`.

Скопируйте шаблон и **отредактируйте пути** в директиве `tls`:

```bash
sudo cp $REPO/deploy/Caddyfile.manual-certs /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Укажите реальные пути к `fullchain.pem` и `privkey.pem`.  
Если использовали **certbot** на этом же VPS:

`tls /etc/letsencrypt/live/mlaffon.fun/fullchain.pem /etc/letsencrypt/live/mlaffon.fun/privkey.pem`

Чтобы **Caddy** читал ключи:

```bash
sudo usermod -aG ssl-cert caddy
sudo systemctl restart caddy
```

(Если группы `ssl-cert` нет — `sudo chgrp caddy /путь/privkey.pem && sudo chmod 640 ...` по ситуации.)

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

### Домен куплен на Jino (Джино)

**Важно:** покупка домена у регистратора — это **не** то же самое, что «готовые файлы `fullchain.pem` и `privkey.pem` на вашем VPS». У Джино в личном кабинете вы управляете **DNS** (A/AAAA на IP сервера) и, при необходимости, **хостингом**; отдельной кнопки «скачать fullchain для своего VPS» часто **нет**, если вы **не** пользуетесь их хостингом для этого сайта.


| Ситуация                                                           | Где «лежат» сертификаты                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Сайт на **вашем VPS** (как в этом гайде), DNS указывает на этот IP | Файлов у Джино для этого сервера **может не быть**. Выпускайте TLS **на VPS**: [вариант A](#a-caddy-сам-получает-сертификат-lets-encrypt) (Caddy + Let's Encrypt) или **certbot** на том же сервере — тогда пути вида `/etc/letsencrypt/live/ваш-домен/`. |
| Сайт на **хостинге Джино** (не на вашем VPS)                       | HTTPS настраивается **у них** на своих машинах; для переноса на VPS нужны **экспортированные PEM** из панели/поддержки **или** новый выпуск на VPS (вариант A).                                                                                           |


Практичный путь для `mlaffon.fun` на своём сервере: **A-запись** домена → IP VPS, порты 80/443 открыты → **вариант A** без ручных PEM. Ручные `fullchain.pem` / `privkey.pem` нужны только если сертификат уже выдан **другим** способом и вы **скопировали** файлы на сервер (см. [вариант B](#b-сертификат-уже-выдан-у-регистратора--certbot--не-через-caddy)).

Справка Джино по SSL в целом: [SSL-сертификаты](https://jino.ru/help/articles/sslcert/) — там про услуги Джино; для **самостоятельного** сервера смотрите ещё раз DNS и выпуск на VPS.

### Проверка

В репозитории `**deploy/Caddyfile`** два блока: `**mlaffon.fun**` (статика `**$REPO/apps/web/dist**`) и `**admin.mlaffon.fun**` (статика `**$REPO/apps/admin/dist**`); в обоих `**/api/***` → `**127.0.0.1:3001**`.

С сервера (часто так и надо проверять API напрямую):

```bash
curl -s http://127.0.0.1:3001/health
```

По HTTPS (если DNS и сертификат в порядке):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://mlaffon.fun/api/v1/me
curl -sS -o /dev/null -w "%{http_code}\n" https://admin.mlaffon.fun/
```

Ожидаемо **401** на `/api/v1/me` без токена; главная админки (SPA) обычно **200**. Ошибка `**curl: (35) ... SSL`** чаще всего из‑за того, что **на VPS ещё нет подходящих PEM** или Caddy пытается **сам** выпустить сертификат (вариант A), пока домен указывает не на этот сервер — тогда используйте вариант **B** с явными путями `tls`.

---

## 9. Telegram

В **BotFather** у Mini App URL: `**https://mlaffon.fun`**.

---

## 10. Обновление кода (веб + админка + API)

**Один скрипт на сервере** (те же пути, что и в гайде: `REPO=/opt/mlaffon/mlaffon-tg-app`):

```bash
cd $REPO
chmod +x deploy/redeploy.sh
./deploy/redeploy.sh
```

Опционально: `deploy/deploy.env` (скопируйте из `deploy/deploy.env.example`) — туда `export VITE_BOT_USERNAME=…` для сборки фронта.  
Без правки БД: `DEPLOY_SKIP_DB=1 ./deploy/redeploy.sh`.  
Обновить только Caddy из репозитория: `DEPLOY_CADDY=1 ./deploy/redeploy.sh`.

Вручную то же самое:

```bash
cd $REPO
git pull
npm ci
npm run build
cd apps/api && npx drizzle-kit push
cd $REPO
sudo chmod -R o+rX apps/api/dist apps/web/dist apps/admin/dist
sudo systemctl restart mlaffon-api mlaffon-worker
```

Новые файлы в `apps/web/dist` и `apps/admin/dist` отдаются сразу после сборки и `chmod` — Caddy перезагружать не нужно, если не меняли сам конфиг.

Если в `git pull` попал обновлённый `deploy/Caddyfile` (поддомен, пути, прокси):

```bash
sudo cp $REPO/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Проверка: `https://mlaffon.fun` (мини-приложение), `https://admin.mlaffon.fun` (админка).

### 10.1 Обновление `.env` (без пересборки)

Переменные читает только процесс API при старте. Если поменяли секреты, URL, `ADMIN_*`, OAuth:

```bash
sudo nano $REPO/apps/api/.env
# сохранить, затем:
sudo systemctl restart mlaffon-api mlaffon-worker
```

`npm run build` для смены `.env` **не нужен**. Убедитесь, что у файла права `640` и владелец как в §6.

### 10.2 HTTPS (SSL) для `admin` и основного домена

Оба сайта описаны в одном `deploy/Caddyfile`: для **`mlaffon.fun`** и **`admin.mlaffon.fun`** Caddy сам запрашивает отдельные сертификаты Let’s Encrypt при первом обращении по HTTPS — **отдельно «включать SSL для админки» не нужно**, если:

1. В DNS есть **A** (или **CNAME**) для **`admin.ваш-домен`** на тот же IP, что и основной сайт.
2. Порты **80** и **443** открыты, Caddy запущен с актуальным конфигом (§8).

После появления DNS-записи подождите пару минут и откройте `https://admin.ваш-домен` — при ошибке смотрите `journalctl -u caddy -e`.

### 10.3 Быстро обновить только фронт (web + админка)

Статика не в systemd — достаточно пересобрать и выставить права на каталоги `dist` (Caddy сразу отдаёт новые файлы, `systemctl restart` не нужен):

```bash
cd $REPO
git pull
npm ci
npm run build
sudo chmod -R o+rX apps/web/dist apps/admin/dist
```

Если менялись переменные **Vite** (`VITE_BOT_USERNAME` и т.д.), они подставляются **на этапе сборки** — без `npm run build` на сервере фронт не увидит новые значения.

---

## Если «ничего не работает»

```bash
sudo journalctl -u mlaffon-api -n 50 --no-pager
sudo journalctl -u mlaffon-worker -n 50 --no-pager
sudo journalctl -u caddy -n 50 --no-pager
cd $REPO && docker compose ps
curl -s http://127.0.0.1:3001/health
```

Часто: Redis/Postgres не подняты, неверный `DATABASE_URL` / `REDIS_URL`, не собран `dist`, порт **3001** занят, у Caddy конфликт порта **80** с Nginx.