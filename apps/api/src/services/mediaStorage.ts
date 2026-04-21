import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  IMAGE_WIDTHS,
  MEDIA_CACHE_CONTROL,
  type ImageWidth,
  getS3Client,
  mediaBucket,
  mediaPublicBaseUrl,
} from "./mediaConfig.js";
import type { RasterVariantBuffers } from "./imagePipeline.js";

function objectKey(hash: string, width: ImageWidth, ext: "avif" | "webp" | "jpg"): string {
  return `images/${hash}/${width}w.${ext}`;
}

export async function uploadRasterSet(
  hash: string,
  variants: RasterVariantBuffers[]
): Promise<void> {
  const client = getS3Client();
  const bucket = mediaBucket();

  const uploads: Promise<unknown>[] = [];

  for (const v of variants) {
    uploads.push(
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(hash, v.width, "avif"),
          Body: v.avif,
          ContentType: "image/avif",
          CacheControl: MEDIA_CACHE_CONTROL,
        })
      ),
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(hash, v.width, "webp"),
          Body: v.webp,
          ContentType: "image/webp",
          CacheControl: MEDIA_CACHE_CONTROL,
        })
      ),
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(hash, v.width, "jpg"),
          Body: v.jpeg,
          ContentType: "image/jpeg",
          CacheControl: MEDIA_CACHE_CONTROL,
        })
      )
    );
  }

  await Promise.all(uploads);
}

export function buildMediaImageResponse(hash: string): {
  hash: string;
  basePath: string;
  widths: ImageWidth[];
  urlsByWidth: Record<string, { avif: string; webp: string; jpeg: string }>;
  srcset: { avif: string; webp: string; jpeg: string };
  fallbackSrc: string;
} {
  const base = `${mediaPublicBaseUrl()}/images/${hash}`;
  const widths = [...IMAGE_WIDTHS];
  const urlsByWidth: Record<string, { avif: string; webp: string; jpeg: string }> =
    {};
  for (const w of widths) {
    urlsByWidth[String(w)] = {
      avif: `${base}/${w}w.avif`,
      webp: `${base}/${w}w.webp`,
      jpeg: `${base}/${w}w.jpg`,
    };
  }
  const srcset = {
    avif: widths.map((w) => `${base}/${w}w.avif ${w}w`).join(", "),
    webp: widths.map((w) => `${base}/${w}w.webp ${w}w`).join(", "),
    jpeg: widths.map((w) => `${base}/${w}w.jpg ${w}w`).join(", "),
  };
  const fallbackW = widths[widths.length - 1]!;
  const fallbackSrc = `${base}/${fallbackW}w.jpg`;
  return {
    hash,
    basePath: base,
    widths,
    urlsByWidth,
    srcset,
    fallbackSrc,
  };
}
