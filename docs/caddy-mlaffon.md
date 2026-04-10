# Caddy для mlaffon.fun

[Caddy](https://caddyserver.com/) сам получает **HTTPS** (Let’s Encrypt), раздаёт **статику** фронта и **проксирует** `/api` на Node (как Nginx в [vps-deploy.md](vps-deploy.md)).

Предполагается:

- репозиторий на сервере, например, в **`/opt/mlaffon/mlaffon-tg-app`**, фронт собран: **`npm run build`** → статика в **`apps/web/dist`**
- **`root` в Caddy указывает на этот `dist` напрямую** — отдельный каталог в `/var/www` не используется
- готовый конфиг: **[deploy/Caddyfile](../deploy/Caddyfile)** → копия в `/etc/caddy/Caddyfile`
- API слушает **`127.0.0.1:3001`** (запуск через **systemd**, см. [vps-deploy.md](vps-deploy.md))
- DNS: **A-запись** `mlaffon.fun` → IP вашего VPS

В **`apps/api/.env`** укажите:

- `PUBLIC_WEB_URL=https://mlaffon.fun`
- OAuth redirect: `https://mlaffon.fun/api/v1/oauth/twitch/callback` и то же для Kick

---

## Установка Caddy (Ubuntu)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

---

## Caddyfile

Скопируйте из репозитория (путь к клону подставьте свой):

```bash
sudo cp /opt/mlaffon/mlaffon-tg-app/deploy/Caddyfile /etc/caddy/Caddyfile
```

В **[deploy/Caddyfile](../deploy/Caddyfile)** указан `root` на  
`/opt/mlaffon/mlaffon-tg-app/apps/web/dist`. Для **WebSocket** (`/api/v1/ws`) у прокси задано `flush_interval -1` — иначе в браузере часто видно обрыв соединения.

Проверка, **первый запуск** (если `caddy.service is not active`):

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl status caddy
```

Дальнейшие правки конфига:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

При первом запуске Caddy сам запросит сертификат для `mlaffon.fun`. Порты **80** и **443** должны быть открыты наружу.

---

## Caddy не стартует: `listen tcp :80: address already in use`

Порт **80** (или **443**) уже занят — чаще всего **Nginx** (или Apache), если вы ставили их по [vps-deploy.md](vps-deploy.md).

Проверка:

```bash
sudo ss -tlnp | grep -E ':80|:443'
```

Если видите **nginx** на `:80`: оставьте **один** фронт-сервер. Либо Caddy, либо Nginx.

**Перейти на Caddy** (остановить Nginx):

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
sudo systemctl enable --now caddy
sudo systemctl status caddy
```

**Остаться на Nginx** — тогда не используйте Caddy: настройте прокси в Nginx по [vps-deploy.md](vps-deploy.md) и не запускайте `caddy.service`.

Предупреждение `Caddyfile input is not formatted` (не критично):

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
```

---

## Если нужен редирект с www

Дополнительно (отдельный блок или импорт):

```caddyfile
www.mlaffon.fun {
    redir https://mlaffon.fun{uri} permanent
}
```

И **A-запись** для `www` на тот же IP.

---

## Nginx и Caddy вместе не слушайте 80/443

Если на сервере уже стоит Nginx на 443 — либо отключите один из веб-серверов, либо оставьте только Caddy (или только Nginx). Один процесс на порту.

---

## Краткая проверка

1. На сервере: `curl -s http://127.0.0.1:3001/health` — ответ `{"ok":true}` (эндпоинт без префикса `/api`).  
2. Через домен: `curl -sS -o /dev/null -w "%{http_code}\n" https://mlaffon.fun/api/v1/me` — ожидаемо **401** без токена (значит `/api` доходит до Fastify).  
3. В BotFather у Mini App URL: `https://mlaffon.fun`.
