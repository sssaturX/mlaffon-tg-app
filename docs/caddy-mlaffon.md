# Caddy для mlaffon.fun

[Caddy](https://caddyserver.com/) сам получает **HTTPS** (Let’s Encrypt), раздаёт **статику** фронта и **проксирует** `/api` на Node (как Nginx в [vps-deploy.md](vps-deploy.md)).

Предполагается:

- репозиторий лежит, например, в **`/root/opt/mlaffon/mlaffon-tg-app`**, фронт собран: **`npm run build`** → статика в `apps/web/dist`
- готовый конфиг в репозитории: **[deploy/Caddyfile](../deploy/Caddyfile)** (скопируйте на сервер в `/etc/caddy/Caddyfile`)
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

Скопируйте из репозитория (на сервере, из каталога клона):

```bash
sudo cp /root/opt/mlaffon/mlaffon-tg-app/deploy/Caddyfile /etc/caddy/Caddyfile
```

В **[deploy/Caddyfile](../deploy/Caddyfile)** уже указан `root` на  
`/root/opt/mlaffon/mlaffon-tg-app/apps/web/dist` и комментарии про права для пользователя `caddy` (при 403 на статику).

Проверка и перезагрузка:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

При первом запуске Caddy сам запросит сертификат для `mlaffon.fun`. Порты **80** и **443** должны быть открыты наружу.

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
