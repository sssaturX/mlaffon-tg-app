Файлы для продакшена на VPS (`REPO=/opt/mlaffon/mlaffon-tg-app`):

| Файл | Назначение |
|------|------------|
| [Caddyfile](Caddyfile) | HTTPS **автоматически** (Caddy + Let’s Encrypt), статика, `/api` |
| [Caddyfile.manual-certs](Caddyfile.manual-certs) | Тот же сайт, но **свои** `fullchain.pem` / `privkey.pem` (уже выданные сертификаты) |
| [mlaffon-api.service](mlaffon-api.service) | systemd: API |
| [mlaffon-worker.service](mlaffon-worker.service) | systemd: BullMQ worker |

Пошаговая инструкция: **[../docs/SIMPLE-START.md](../docs/SIMPLE-START.md)**.
