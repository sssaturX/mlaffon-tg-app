import { S3Client } from "@aws-sdk/client-s3";

export const MAX_ORIGINAL_IMAGE_BYTES = 10 * 1024 * 1024;
/**
 * Потолок на один вариант (AVIF/WebP/JPEG для данной ширины).
 * ~24 KiB — ориентир «ультра-лёгкие» картинки для быстрой отдачи по CDN.
 */
export const MAX_VARIANT_BYTES = 24 * 1024;
/** Варианты по ширине (px). Без 1920 — меньше пикселей и размер файла. */
export const IMAGE_WIDTHS = [320, 640, 960, 1280] as const;
/**
 * Перед генерацией вариантов уменьшаем сторону до этого значения (быстрее CPU и меньше вес).
 */
export const MAX_PROCESSING_EDGE_PX = 1600;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

let s3Client: S3Client | null = null;

export function mediaStorageConfigured(): boolean {
  return Boolean(
    process.env.MEDIA_S3_BUCKET?.trim() &&
      process.env.MEDIA_PUBLIC_BASE_URL?.trim() &&
      process.env.AWS_ACCESS_KEY_ID?.trim() &&
      process.env.AWS_SECRET_ACCESS_KEY?.trim()
  );
}

export function getS3Client(): S3Client {
  if (!s3Client) {
    const endpoint = process.env.MEDIA_S3_ENDPOINT?.trim();
    s3Client = new S3Client({
      region: process.env.MEDIA_S3_REGION?.trim() || "auto",
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: process.env.MEDIA_S3_FORCE_PATH_STYLE === "1",
    });
  }
  return s3Client;
}

export function mediaPublicBaseUrl(): string {
  return (process.env.MEDIA_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

export function mediaBucket(): string {
  return process.env.MEDIA_S3_BUCKET!.trim();
}
