# CDN и объектное хранилище для медиа (S3 / Cloudflare R2)

Полный порядок настройки: **хранилище → доступ API (загрузка с сервера) → публичный URL (раздача в браузер) → переменные окружения → проверка**.

Как устроено в коде: API принимает файл, обрабатывает (AVIF / WebP / JPEG, несколько ширин), заливает объекты в бакет по путям вида `images/{sha256}/{width}w.{ext}` и отдаёт клиенту URL с префиксом **`MEDIA_PUBLIC_BASE_URL`**. Подробности API и заголовков кеша: [IMAGES.md](IMAGES.md).

**Аудитория в РФ:** пошаговый разбор «локальное object storage + CDN с российским edge» (Yandex и универсально для других провайдеров) — в **[cdn-russia.md](cdn-russia.md)**.

---

## 1. Что вам нужно в итоге

| Цель | Что это |
|------|--------|
| **Приватная запись** | Сервер приложения ходит в хранилище по **S3 API** с **Access Key + Secret** (или совместимым токеном R2). |
| **Публичное чтение** | Браузер открывает картинки по **HTTPS URL** — обычно отдельный поддомен (`https://img.ваш-домен.com/...`) через **кастомный домен R2** или **CloudFront** / прокси. |
| **В `.env`** | Имя бакета, endpoint для API, регион, ключи, и **ровно тот базовый URL**, который видит пользователь в браузере (`MEDIA_PUBLIC_BASE_URL`). |

Никаких отдельных «CDN API ключей» для браузера не требуется: CDN/R2 отдаёт файлы по обычным GET-запросам.

---

## 2. Переменные окружения (сводка)

Заполняйте в **`apps/api/.env`** или в **`deploy/deploy.env`** с директивой `export` (при `./deploy/redeploy.sh` пустые поля допишутся в `apps/api/.env` — см. [README.md](README.md)).

| Переменная | Обязательно | Пример / значение |
|------------|-------------|-------------------|
| `MEDIA_S3_BUCKET` | да | `mlaffon-media` |
| `MEDIA_PUBLIC_BASE_URL` | да | `https://img.example.com` (без `/` в конце) |
| `AWS_ACCESS_KEY_ID` | да | Access Key ID (AWS IAM или R2 API token id) |
| `AWS_SECRET_ACCESS_KEY` | да | Secret (AWS или R2) |
| `MEDIA_S3_REGION` | да для AWS; для R2 часто | `auto` (R2) или `eu-central-1` (AWS) |
| `MEDIA_S3_ENDPOINT` | для R2 / MinIO | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `MEDIA_S3_FORCE_PATH_STYLE` | иногда | `1` для MinIO; для R2 попробуйте без, при ошибках SDK — `1` |

Минимальный набор для «включена загрузка»: первые **четыре** строки таблицы + корректный `REGION` и при R2 **`ENDPOINT`**.

---

## 3. Вариант A — Cloudflare R2 (пошагово)

Удобно, если домен уже на Cloudflare.

### Шаг A1. Аккаунт и Account ID

1. Зайдите в [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Справа вверху или в разделе **R2** найдите **Account ID** (длинная строка). Она понадобится для endpoint.

### Шаг A2. Создать бакет

1. **R2** → **Create bucket**.
2. Имя, например `mlaffon-media` — это значение **`MEDIA_S3_BUCKET`**.

### Шаг A3. API-токен (ключи для сервера)

1. **R2** → **Overview** → **Manage R2 API Tokens** (или аналог в интерфейсе).
2. **Create API token**:
   - тип: как минимум **Object Read & Write** на нужный бакет (или Admin Read & Write на один бакет — по политике безопасности).
3. Сохраните **Access Key ID** и **Secret Access Key** — они один раз показываются целиком. Подставьте в **`AWS_ACCESS_KEY_ID`** и **`AWS_SECRET_ACCESS_KEY`**.

### Шаг A4. S3-совместимый endpoint

Формула:

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

Подставьте свой Account ID → это **`MEDIA_S3_ENDPOINT`**.

**`MEDIA_S3_REGION`**: для R2 укажите `auto` (как в документации Cloudflare для S3 API).

**`MEDIA_S3_FORCE_PATH_STYLE`**: начните **без** переменной. Если при загрузке SDK ругается на URL/виртуальный хост — добавьте `MEDIA_S3_FORCE_PATH_STYLE=1`.

### Шаг A5. Публичный URL (то, что попадёт в браузер)

Нужен HTTPS-адрес, по которому открывается объект`https://…/images/<hash>/320w.avif`.

**Рекомендуемый путь — Custom Domain к бакету R2:**

1. В Cloudflare: **R2** → ваш бакет → **Settings** / **Custom Domains** (название может быть «Connect Domain», «Public access»).
2. Добавьте поддомен, например `img` для зоны `example.com` → итог **`https://img.example.com`**.
3. Cloudflare сам настроит DNS и прокси для этого поддомена к R2.

Это значение и есть **`MEDIA_PUBLIC_BASE_URL=https://img.example.com`** (без слэша в конце).

Альтернатива на время отладки — публичный R2 dev URL (если включите публичный доступ к бакету); для прода лучше кастомный домен и нормальный кеш.

### Шаг A6. Проверка прав на чтение

Откройте в браузере или через `curl` тестовый объект, который вы зальёте вручную или через API после деплоя. Если403 — в настройках бакета/домена проверьте политику публичного чтения для префикса `images/` или настройку Custom Domain.

### Шаг A7. Запись в `deploy/deploy.env`

Пример (замените на свои значения):

```bash
export MEDIA_S3_BUCKET=mlaffon-media
export MEDIA_PUBLIC_BASE_URL=https://img.example.com
export MEDIA_S3_ENDPOINT=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.cloudflarestorage.com
export MEDIA_S3_REGION=auto
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
# при необходимости:
# export MEDIA_S3_FORCE_PATH_STYLE=1
```

Затем на сервере: `./deploy/redeploy.sh` (или вручную скопируйте строки в `apps/api/.env`).

---

## 4. Вариант B — Amazon S3 + CloudFront

### Шаг B1. S3-бакет

1. [AWS Console](https://console.aws.amazon.com/s3/) → **Create bucket**.
2. Регион запомните — **`MEDIA_S3_REGION`** (например `eu-central-1`).
3. **`MEDIA_S3_BUCKET`** — имя бакета.

### Шаг B2. IAM для сервера

1. **IAM** → **Users** (или роль для EC2, если API на AWS) → создать access key.
2. Политика: `s3:PutObject`, `s3:GetObject` (и при необходимости `ListBucket`) **только** на ваш бакет/префикс `images/*`.
3. Ключи → **`AWS_ACCESS_KEY_ID`**, **`AWS_SECRET_ACCESS_KEY`**.

**`MEDIA_S3_ENDPOINT`** для классического AWS **не задаётте** (SDK сам выберет региональный endpoint).

### Шаг B3. Публичная раздача

- Либо **CloudFront**: distribution с origin = бакет (часто через OAC), кастомный домен `img.example.com` → **`MEDIA_PUBLIC_BASE_URL=https://img.example.com`** (или домен вида `d123.cloudfront.net`).
- Либо публичный бакет + политика чтения (проще, но без типичных преимуществ CDN).

### Шаг B4. Пример `.env`

```bash
MEDIA_S3_BUCKET=your-bucket
MEDIA_PUBLIC_BASE_URL=https://dxxxxxxxxxxxx.cloudfront.net
MEDIA_S3_REGION=eu-central-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

---

## 5. Вариант C — MinIO (свой сервер)

1. Поднимаете MinIO, создаёте бакет и пользователя с ключами.
2. **`MEDIA_S3_ENDPOINT`** = URL API MinIO, например `https://minio.example.com` или `http://127.0.0.1:9000` (в проде только HTTPS).
3. Обычно **`MEDIA_S3_FORCE_PATH_STYLE=1`**.
4. **`MEDIA_PUBLIC_BASE_URL`** = URL, по которому браузер реально получает файлы (reverse proxy / публичный MinIO / отдельный CDN перед MinIO).

---

## 6. DNS (если свой поддомен под картинки)

1. У регистратора или в Cloudflare создайте запись:
   - **CNAME** `img` → то, что указано в мастере Custom Domain R2, **или**
   - **A/ALIAS** по инструкции CloudFront / хостинга.
2. Дождитесь распространения DNS (`dig img.example.com`).

---

## 7. Связка с приложением и деплоем

1. После заполнения переменных перезапустите API (`systemctl restart mlaffon-api` или полный `./deploy/redeploy.sh`).
2. В админке загрузите тестовую картинку (задание / магазин / розыгрыш) или выполните `POST /api/admin/media/images` с multipart полем `file`.
3. В ответе будут URL вида `https://img.example.com/images/<hash>/1280w.jpg`. Откройте один из них в браузере — должен быть **200** и корректный `Content-Type` (например `image/jpeg`).

Проверка загрузки с машины разработчика (см. также [IMAGES.md](IMAGES.md)):

```bash
cd apps/api
# локально нужен тот же .env с MEDIA_* и ключами
npx tsx src/scripts/uploadMedia.ts ./test.jpg
```

---

## 8. Caddy, CSP и смешанный контент

- В [Caddyfile](Caddyfile) для основного сайта уже разрешён `img-src ... https:` — картинки с **`MEDIA_PUBLIC_BASE_URL`** на другом хосте допустимы.
- Если когда-нибудь сузите CSP до белого списка хостов — добавьте хост из **`MEDIA_PUBLIC_BASE_URL`** в `img-src`.

---

## 9. Типичные ошибки

| Симптом | Что проверить |
|---------|----------------|
| `503 media_unconfigured` | Не заданы `MEDIA_S3_BUCKET`, `MEDIA_PUBLIC_BASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` в окружении процесса API. |
| `storage_failed` / 503 при загрузке | Неверный endpoint, регион, ключи, имя бакета; для R2 — Account ID в URL; права токена на запись в бакет. |
| Объект в бакете есть, в браузере 403 | Нет публичного чтения / неверный Custom Domain / политика бакета. |
| Картинки с неправильного домена | **`MEDIA_PUBLIC_BASE_URL`** должен совпадать с тем URL, который реально отдаёт файлы пользователю (CDN/домен R2), иначе в HTML будут «чужие» ссылки. |

---

## 10. Чеклист перед продом

- [ ] Бакет создан, ключи API только для нужных прав (не root на весь аккаунт без необходимости).
- [ ] **`MEDIA_PUBLIC_BASE_URL`** = HTTPS, без завершающего `/`.
- [ ] Тестовый объект открывается в браузере по URL из ответа API.
- [ ] Секреты только в `apps/api/.env` / `deploy/deploy.env` на сервере, не в git.
- [ ] После смены ключей или домена — перезапуск `mlaffon-api`.

---

## 11. Дополнительные материалы в репозитории

- [cdn-russia.md](cdn-russia.md) — объектное хранилище и CDN для низкой задержки в РФ.
- [IMAGES.md](IMAGES.md) — эндпоинты, `curl`, CLI, preload, Lighthouse.
- [deploy.env.example](deploy.env.example) — шаблон `export` для redeploy.
- Код загрузки: `apps/api/src/services/mediaStorage.ts`, `mediaUploadService.ts`.
