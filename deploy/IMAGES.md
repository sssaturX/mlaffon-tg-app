# Изображения: S3 / R2 + CDN

Пайплайн в коде: `apps/api` — Sharp (AVIF / WebP / JPEG), ключи `images/{sha256}/{width}w.{ext}`, заголовок `Cache-Control: public, max-age=31536000, immutable`.

## Переменные окружения (`apps/api/.env`)

| Переменная | Назначение |
|------------|------------|
| `MEDIA_S3_BUCKET` | Имя бакета |
| `MEDIA_PUBLIC_BASE_URL` | Публичный URL без хвостового `/` (домен CDN или public bucket), например `https://img.example.com` |
| `AWS_ACCESS_KEY_ID` | Ключ S3-совместимого API |
| `AWS_SECRET_ACCESS_KEY` | Секрет |
| `MEDIA_S3_REGION` | Регион (для R2 часто `auto`) |
| `MEDIA_S3_ENDPOINT` | Опционально: кастомный endpoint (MinIO, Cloudflare R2) |
| `MEDIA_S3_FORCE_PATH_STYLE` | `1` для MinIO и части S3-совместимых бэкендов |

Если чего-то из первых четырёх нет, `POST /api/v1/media/images` отвечает `503 media_unconfigured`.

**Прод:** удобно держать значения в `deploy/deploy.env` как `export MEDIA_S3_BUCKET=…` и т.д. — при `./deploy/redeploy.sh` они **дописываются** в `apps/api/.env`, если там строки ещё нет (тот же механизм, что для `PUBLIC_WEB_URL`). См. `deploy/deploy.env.example`.

## HTTP API

- **Метод:** `POST /api/v1/media/images` — пользовательский JWT (мини-апп / сайт).
- **Админка:** `POST /api/admin/media/images` — тот же `multipart` и ответ; заголовок `Authorization: Bearer` с **админским** токеном (после `/api/admin/login`). Используется формой загрузки картинок в админ-панели (задания, магазин, розыгрыши).

### Пользовательский эндпоинт

- **Метод:** `POST /api/v1/media/images`
- **Авторизация:** Bearer (как остальной `/api/v1`)
- **Тело:** `multipart/form-data`, поле файла: **`file`**
- **Лимит оригинала:** 10 МБ
- **Ответ:** JSON с `hash`, `basePath`, `srcset` (avif/webp/jpeg), `fallbackSrc`, `lqipDataUrl`, `urlsByWidth`, `processMs`

Пример `curl` (подставьте токен и хост API):

```bash
curl -X POST "https://api.example.com/api/v1/media/images" \
  -H "Authorization: Bearer YOUR_JWT" \
  -F "file=@./photo.jpg"
```

## CLI-скрипт (без HTTP)

Из каталога `apps/api` при настроенном `.env`:

```bash
npx tsx src/scripts/uploadMedia.ts /path/to/photo.jpg
```

Без S3 выведет `dryRun: true` и те же URL, что были бы после загрузки.

## CDN

1. Объектное хранилище: **Amazon S3**, **Cloudflare R2**, **MinIO** и т.п.
2. Публичная раздача **только через CDN** (Cloudflare, CloudFront и др.):
   - Origin = публичный endpoint бакета или прокси к нему.
   - `MEDIA_PUBLIC_BASE_URL` = URL зоны CDN (кастомный домен).
3. Не перезаписывайте объекты: новый файл → новый `hash` в пути; инвалидация не нужна.

### Cloudflare R2 (через кастомный домен)

1. Создать бакет, включить публичный доступ или Worker для выдачи.
2. Подключить **Custom Domain** к R2.
3. В API: `MEDIA_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com`, `MEDIA_S3_REGION=auto`, `MEDIA_PUBLIC_BASE_URL=https://img.yourdomain.com`, ключи API токена R2.

### AWS CloudFront + S3

1. Бакет приватный, CloudFront OAC к бакету; либо публичный бакет + CloudFront перед ним.
2. `MEDIA_PUBLIC_BASE_URL=https://d1234567890.cloudfront.net` (или свой домен).

## Caddy / CSP

В `deploy/Caddyfile` уже задано `img-src ... https:` — отдельный хост CDN разрешён. Если ужесточаете CSP до конкретных хостов, добавьте домен из `MEDIA_PUBLIC_BASE_URL`.

## Фронтенд

Компонент `apps/web/src/components/ResponsivePicture.tsx` — `<picture>`, `loading` / `fetchPriority` для hero, LQIP, `decoding="async"`. Передайте честный атрибут `sizes`, чтобы браузер не запрашивал лишнюю ширину.

### Hero / LCP

На странице добавьте preload (подставьте свой URL из ответа API):

```html
<link
  rel="preload"
  as="image"
  href="https://img.example.com/images/<hash>/1280w.avif"
  imagesrcset="https://img.example.com/images/<hash>/320w.avif 320w, ..."
  imagesizes="100vw"
  type="image/avif"
/>
```

## Проверка (Lighthouse / WebPageTest)

После деплоя прогоните Lighthouse и WebPageTest по страницам с новыми картинками. Цели из ТЗ: Performance ≥ 90, без предупреждений «Properly size images» при корректном `sizes`.
