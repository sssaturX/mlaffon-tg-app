Файлы для продакшена на VPS (`REPO=/opt/mlaffon/mlaffon-tg-app`):

| Файл | Назначение |
|------|------------|
| [Caddyfile](Caddyfile) | HTTPS **автоматически** (Caddy + Let’s Encrypt), статика, `/api` |
| [Caddyfile.manual-certs](Caddyfile.manual-certs) | Тот же сайт, но **свои** `fullchain.pem` / `privkey.pem` (уже выданные сертификаты) |
| [mlaffon-api.service](mlaffon-api.service) | systemd: API |
| [mlaffon-worker.service](mlaffon-worker.service) | systemd: BullMQ worker |
| [redeploy.sh](redeploy.sh) | **Быстрый деплой на сервере**: `git pull`, сборка, `drizzle-kit push`, `chmod`, restart API/worker (см. комментарии в скрипте) |
| [deploy.env.example](deploy.env.example) | Пример `deploy/deploy.env` для `VITE_*` при сборке |

Пошаговая инструкция: **[../docs/SIMPLE-START.md](../docs/SIMPLE-START.md)**.
