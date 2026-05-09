# Гайд по .env — откуда брать каждое значение

Этот файл описывает **каждую** переменную окружения: что это, откуда взять,
как сгенерировать, и обязательна ли она.

---

## Обязательные для запуска (без них API упадёт)

### `DATABASE_URL`
**Что:** Строка подключения к PostgreSQL.
**Формат:** `postgres://USER:PASSWORD@HOST:PORT/DBNAME`
**Откуда:**
- Если PostgreSQL установлен через `bootstrap.sh` — скрипт выведет готовый URL с автосгенерированным паролем.
- Если ставил вручную — собери из имени пользователя, пароля и названия БД которые ты создал.
- Пример: `postgres://mlaffon:s3cretpass@127.0.0.1:5432/mlaffon`

---

### `JWT_SECRET`
**Что:** Ключ подписи JWT-токенов пользователей. Минимум 16 символов.
**Откуда:** Сгенерировать на сервере:
```bash
openssl rand -hex 32
```
Результат — 64-символьная hex-строка. Скопировать и вставить.

---

### `REDIS_URL`
**Что:** Адрес Redis.
**Формат:** `redis://HOST:PORT`
**Откуда:** Если Redis стоит локально (стандарт) — просто:
```
redis://127.0.0.1:6379
```
Менять не нужно, если Redis на том же сервере.

---

### `TELEGRAM_BOT_TOKEN`
**Что:** API-токен бота из Telegram.
**Откуда:**
1. Открой [@BotFather](https://t.me/BotFather) в Telegram.
2. `/mybots` → выбери бота → **API Token**.
3. Формат: `1234567890:ABCDefghIJKLmnopQRSTuvwxyz`

---

### `TOKENS_ENCRYPTION_KEY`
**Что:** Ключ шифрования OAuth-токенов (AES-256-GCM). Base64, 32 байта.
**Откуда:** Сгенерировать:
```bash
openssl rand -base64 32
```
Результат — строка вроде `k7F2aB3x...==`. Скопировать целиком.

---

## Обязательные в production (`NODE_ENV=production`)

### `NODE_ENV`
**Что:** Режим работы.
**Значение:** `production`
**Примечание:** Без этого флага не работают CORS-проверки и security-гейты.

---

### `CORS_ORIGINS` или `PUBLIC_WEB_URL`
**Что:** Разрешённые домены для CORS. Нужен хотя бы один из двух.
**Откуда:** Твои домены. Например:
```
CORS_ORIGINS=https://mlaffon.fun,https://admin.mlaffon.fun
PUBLIC_WEB_URL=https://mlaffon.fun
PUBLIC_ADMIN_URL=https://admin.mlaffon.fun
```

---

## Telegram (бот)

### `TELEGRAM_BOT_USERNAME`
**Что:** Имя бота (без @).
**Откуда:** То же, что и при создании в BotFather. Например: `MlaffonBot`

---

## OAuth: Twitch

### `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`
**Что:** Ключи Twitch-приложения для OAuth.
**Откуда:**
1. Зайди на [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Создай приложение (или открой существующее).
3. **Client ID** — видно на странице приложения.
4. **Client Secret** — нажми «New Secret» (покажет один раз).

### `TWITCH_REDIRECT_URI`
**Что:** Callback URL после авторизации.
**Значение для прода:**
```
https://mlaffon.fun/api/v1/oauth/twitch/callback
```
**Важно:** Этот же URL должен быть добавлен в настройках Twitch-приложения (OAuth Redirect URLs).

---

## OAuth: Kick

### `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET`
**Что:** Ключи Kick-приложения для OAuth.
**Откуда:**
1. Зайди в Kick Developer Dashboard.
2. Создай приложение.
3. Скопируй Client ID и Client Secret.

### `KICK_REDIRECT_URI`
**Значение для прода:**
```
https://mlaffon.fun/api/v1/oauth/kick/callback
```

---

## Админ-панель

### `ADMIN_EMAIL`
**Что:** Email для входа в админку.
**Откуда:** Придумай сам. Например: `admin@mlaffon.fun`

### `ADMIN_PASSWORD`
**Что:** Пароль для входа в админку.
**Откуда:** Придумай надёжный пароль (16+ символов) или сгенерируй:
```bash
openssl rand -base64 24
```

### `ADMIN_PASSPHRASE`
**Что:** Дополнительная фраза аутентификации (второй фактор).
**Откуда:** Придумай кодовую фразу, которую знаешь только ты.

### `ADMIN_JWT_SECRET`
**Что:** Отдельный ключ подписи для admin JWT (изолирует админские токены от пользовательских).
**Откуда:**
```bash
openssl rand -hex 32
```

---

## Frontend (Vite)

### `VITE_BOT_USERNAME`
**Что:** Имя бота для отображения в UI.
**Значение:** То же самое, что `TELEGRAM_BOT_USERNAME`. Например: `MlaffonBot`

### Остальные `VITE_*` переменные — опциональные:
- `VITE_PRIVACY_POLICY_URL` — ссылка на политику конфиденциальности
- `VITE_CREATOR_DISPLAY_NAME` — имя стримера/создателя
- `VITE_CREATOR_AVATAR_URL` — URL аватарки
- `VITE_CREATOR_KICK_LABEL` / `VITE_CREATOR_TWITCH_LABEL` — текст кнопок
- `VITE_CREATOR_KICK_PAGE_URL` — ссылка на канал

---

## Медиа: S3-хранилище (опционально)

Без этих переменных загрузка картинок через API вернёт 503.

### `MEDIA_S3_BUCKET`
**Что:** Имя бакета.
**Откуда:** Создай бакет в Yandex Object Storage (или AWS S3).
**Пример:** `mlaffon-apps`

### `MEDIA_PUBLIC_BASE_URL`
**Что:** Публичный URL для отдачи картинок через CDN.
**Пример:** `https://img.mlaffon.fun`

### `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
**Что:** Ключи доступа к S3-совместимому хранилищу.
**Откуда:**
- **Yandex Cloud:** Консоль → Сервисные аккаунты → Создать статический ключ.
- **AWS:** IAM → Users → Security Credentials → Access Keys.

### `MEDIA_S3_REGION`
**Что:** Регион хранилища.
**Для Yandex Cloud:** `ru-central1`

### `MEDIA_S3_ENDPOINT`
**Что:** URL эндпоинта S3 API.
**Для Yandex Cloud:** `https://storage.yandexcloud.net`

### `MEDIA_S3_FORCE_PATH_STYLE`
**Что:** Использовать path-style вместо virtual-hosted-style.
**Для Yandex Cloud:** `1`

---

## Web Push (опционально)

### `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
**Что:** Ключи для Web Push уведомлений.
**Откуда:** Сгенерировать:
```bash
cd apps/api && npx web-push generate-vapid-keys
```
Выведет оба ключа — скопировать.

### `VAPID_SUBJECT`
**Что:** Контактный email для push-провайдера.
**Формат:** `mailto:itoly569@gmail.com`

---

## CDN (deploy pipeline)

### `CDN_PROVIDER`
**Что:** Какой CDN используется.
**Значения:** `yandex` | `cloudflare` | `none`
**Для прода:** `yandex`

### `YC_CDN_RESOURCE_ID`
**Что:** ID CDN-ресурса в Yandex Cloud.
**Откуда:** После создания CDN-ресурса: `yc cdn resource list`

### `YC_FOLDER_ID`
**Что:** ID папки (folder) в Yandex Cloud.
**Откуда:** Консоль Yandex Cloud → обзор облака → ID каталога.

---

## Настройки, которые можно оставить по умолчанию

| Переменная | Дефолт | Что делает |
|---|---|---|
| `PORT` | `3001` | Порт API |
| `HOST` | `0.0.0.0` | Адрес привязки API |
| `PG_POOL_MAX` | `20` | Макс. соединений к БД |
| `LOG_LEVEL` | `info` | Уровень логирования |
| `WS_TICKET_TTL_SEC` | `25` | TTL WebSocket-тикетов |
| `AUTH_RATE_LIMIT_MAX` | `15` | Лимит попыток auth в окне |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | Окно rate limit (15 мин) |

---

## Запрещено в production

| Переменная | Почему |
|---|---|
| `ALLOW_DEV_AUTH=1` | Открывает dev-маршруты аутентификации — дыра в безопасности |
| `VITE_ALLOW_DEV=1` | Включает dev-режим на фронте |
| `VITE_ALLOW_DEV_STUB=1` | Включает dev-стабы |
| `JWT_SECRET=dev-only-change-me` | Дефолтный ключ — API упадёт при старте |

---

## Шпаргалка: все команды генерации

```bash
# JWT_SECRET
openssl rand -hex 32

# ADMIN_JWT_SECRET
openssl rand -hex 32

# TOKENS_ENCRYPTION_KEY
openssl rand -base64 32

# ADMIN_PASSWORD
openssl rand -base64 24

# VAPID ключи
cd apps/api && npx web-push generate-vapid-keys
```

---

## Минимальный .env для первого запуска

```env
NODE_ENV=production
DATABASE_URL=postgres://mlaffon:ПАРОЛЬ@127.0.0.1:5432/mlaffon
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<результат openssl rand -hex 32>
TOKENS_ENCRYPTION_KEY=<результат openssl rand -base64 32>
TELEGRAM_BOT_TOKEN=<токен от BotFather>
TELEGRAM_BOT_USERNAME=MlaffonBot
PUBLIC_WEB_URL=https://mlaffon.fun
PUBLIC_ADMIN_URL=https://admin.mlaffon.fun
CORS_ORIGINS=https://mlaffon.fun,https://admin.mlaffon.fun
PORT=3001
HOST=0.0.0.0
VITE_BOT_USERNAME=MlaffonBot
CDN_PROVIDER=yandex
```

Всё остальное — либо опционально, либо имеет рабочие дефолты.

---

## Максимальный .env для production (все фичи включены)

```env
# ── Core ──────────────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgres://mlaffon:ПАРОЛЬ@127.0.0.1:5432/mlaffon
PG_POOL_MAX=20
PG_CONNECTION_TIMEOUT_MS=10000
PG_IDLE_TIMEOUT_MS=30000

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://127.0.0.1:6379

# ── Secrets (сгенерируй каждый отдельно!) ─────────────────────────────────────
JWT_SECRET=<openssl rand -hex 32>
ADMIN_JWT_SECRET=<openssl rand -hex 32>
TOKENS_ENCRYPTION_KEY=<openssl rand -base64 32>

# ── Telegram ──────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=<токен от BotFather>
TELEGRAM_BOT_USERNAME=MlaffonBot
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
TELEGRAM_LIVE_NOTIFY_CHAT_ID=<ID чата для уведомлений о стримах>
TELEGRAM_WELCOME_PHOTO_URL=https://mlaffon.fun/bot-welcome.png
TELEGRAM_GUIDE_TELEGRAPH_URL=https://telegra.ph/...
TELEGRAM_SUPPORT_URL=https://t.me/mlaffon_support

# ── Public URLs ───────────────────────────────────────────────────────────────
PUBLIC_WEB_URL=https://mlaffon.fun
PUBLIC_ADMIN_URL=https://admin.mlaffon.fun
CORS_ORIGINS=https://mlaffon.fun,https://admin.mlaffon.fun

# ── OAuth: Twitch ─────────────────────────────────────────────────────────────
TWITCH_CLIENT_ID=<Client ID из Twitch Developer Console>
TWITCH_CLIENT_SECRET=<Client Secret из Twitch Developer Console>
TWITCH_REDIRECT_URI=https://mlaffon.fun/api/v1/oauth/twitch/callback

# ── OAuth: Kick ───────────────────────────────────────────────────────────────
KICK_CLIENT_ID=<Client ID из Kick Developer>
KICK_CLIENT_SECRET=<Client Secret из Kick Developer>
KICK_REDIRECT_URI=https://mlaffon.fun/api/v1/oauth/kick/callback

# ── Admin ─────────────────────────────────────────────────────────────────────
ADMIN_EMAIL=admin@mlaffon.fun
ADMIN_PASSWORD=<openssl rand -base64 24>
ADMIN_PASSPHRASE=<придумай кодовую фразу>

# ── Frontend ──────────────────────────────────────────────────────────────────
VITE_BOT_USERNAME=MlaffonBot
VITE_PRIVACY_POLICY_URL=https://mlaffon.fun/privacy
VITE_CREATOR_DISPLAY_NAME=Mlaffon
VITE_CREATOR_AVATAR_URL=https://img.mlaffon.fun/avatar.webp
VITE_CREATOR_TWITCH_LABEL=Twitch
VITE_CREATOR_KICK_LABEL=Kick
VITE_CREATOR_KICK_PAGE_URL=https://kick.com/mlaffon

# ── Web Push (VAPID) ─────────────────────────────────────────────────────────
VAPID_PUBLIC_KEY=<npx web-push generate-vapid-keys → Public Key>
VAPID_PRIVATE_KEY=<npx web-push generate-vapid-keys → Private Key>
VAPID_SUBJECT=mailto:itoly569@gmail.com

# ── Media: S3 (Yandex Object Storage) ────────────────────────────────────────
MEDIA_S3_BUCKET=mlaffon-apps
MEDIA_PUBLIC_BASE_URL=https://img.mlaffon.fun
AWS_ACCESS_KEY_ID=<статический ключ из Yandex Cloud>
AWS_SECRET_ACCESS_KEY=<секретный ключ из Yandex Cloud>
MEDIA_S3_REGION=ru-central1
MEDIA_S3_ENDPOINT=https://storage.yandexcloud.net
MEDIA_S3_FORCE_PATH_STYLE=1

# ── Anti-abuse ────────────────────────────────────────────────────────────────
ABUSE_CLAIM_PER_USER_PER_MIN=30
ABUSE_CLAIM_PER_IP_PER_MIN=200
ABUSE_OAUTH_CALLBACK_PER_IP_PER_MIN=60
ABUSE_WEB_REF_REGISTER_PER_IP_PER_DAY=10

# ── WebSocket ─────────────────────────────────────────────────────────────────
WS_TICKET_TTL_SEC=25
WS_CONNECT_ATTEMPTS_PER_MINUTE=30
WS_MAX_CONCURRENT_PER_IP=8

# ── Auth rate limiting ────────────────────────────────────────────────────────
AUTH_RATE_LIMIT_MAX=15
AUTH_RATE_LIMIT_WINDOW_MS=900000

# ── OBS TTS: SpeakerPy ───────────────────────────────────────────────────────
# deploy/release.sh устанавливает ffmpeg, venv и requirements-speakerpy.txt автоматически.
SPEAKERPY_TTS_ENABLED=1
SPEAKERPY_PYTHON_BIN=/opt/mlaffon/shared/speakerpy-venv/bin/python
SPEAKERPY_MODEL_ID=ru_v3
SPEAKERPY_LANGUAGE=ru
SPEAKERPY_DEVICE=cpu
SPEAKERPY_CACHE_DIR=/opt/mlaffon/shared/speakerpy-cache/audio
TORCH_HOME=/opt/mlaffon/shared/speakerpy-cache/torch
NLTK_DATA=/opt/mlaffon/shared/speakerpy-cache/nltk
SPEAKERPY_TIMEOUT_MS=45000

# ── Tracing / logging ────────────────────────────────────────────────────────
LOG_LEVEL=info
API_SLOW_REQUEST_MS=2000

# ── CDN (deploy pipeline) ────────────────────────────────────────────────────
CDN_PROVIDER=yandex
YC_CDN_RESOURCE_ID=<yc cdn resource list → ID>
YC_FOLDER_ID=<ID каталога из Yandex Cloud Console>
```
