# Простой запуск на сервере (всё в одном месте)

**Репозиторий:** `/opt/mlaffon/mlaffon-tg-app`  
**Домен:** `mlaffon.fun` (в Caddy уже прописан; в `.env` должны быть `PUBLIC_WEB_URL=https://mlaffon.fun` и OAuth redirect на этот домен).

**Соответствие «как локально»:**

| Локально | На сервере |
|----------|------------|
| `docker compose up -d` | То же |
| `npm run dev` (API + Vite) | `npm run build` → API из `dist` + статика из `apps/web/dist` |
| `npm run worker -w api` | Отдельный процесс `node dist/worker.js` (через systemd) |
| Браузер → Vite прокси `/api` | **Caddy** отдаёт сайт и шлёт `/api` на `127.0.0.1:3001` |

Нужны: **Ubuntu**, **Node.js 20+**, **Docker** + Compose, **Caddy**. Один раз откройте порты **22, 80, 443** (ufw).

---

## 0. Переменные (удобно в шелле)

```bash
export REPO=/opt/mlaffon/mlaffon-tg-app
export VITE_BOT_USERNAME=ИмяБотаБезСобаки
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

Репозиторий уже должен лежать в `$REPO`. Файл **`$REPO/apps/api/.env`** заполните (как в `.env.example` в корне репо): `DATABASE_URL`, `REDIS_URL`, Telegram, секреты, **`PORT=3001`**, **`PUBLIC_WEB_URL=https://mlaffon.fun`**, Twitch/Kick redirect на `https://mlaffon.fun/api/v1/.../callback`.  
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

Должны появиться каталоги **`apps/api/dist`** и **`apps/web/dist`**.

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
sudo chmod o+x /opt /opt/mlaffon $REPO $REPO/apps $REPO/apps/api $REPO/apps/web
sudo chmod -R o+rX $REPO/apps/api/dist $REPO/apps/web/dist
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

```bash
sudo cp $REPO/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl status caddy --no-pager
```

В конфиге: **`mlaffon.fun`**, статика из **`$REPO/apps/web/dist`**, **`/api`** → **`127.0.0.1:3001`**.

Проверка с сервера:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://mlaffon.fun/api/v1/me
```

Ожидаемо **401** без токена (значит Caddy достучался до API).

---

## 9. Telegram

В **BotFather** у Mini App URL: **`https://mlaffon.fun`**.

---

## 10. Обновление кода

```bash
cd $REPO
git pull
npm ci
npm run build
cd apps/api && npx drizzle-kit push
cd $REPO
sudo chmod -R o+rX apps/api/dist apps/web/dist
sudo systemctl restart mlaffon-api mlaffon-worker
sudo systemctl reload caddy
```

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
