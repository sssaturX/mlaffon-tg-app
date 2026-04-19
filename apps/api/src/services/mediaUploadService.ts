import type { FastifyBaseLogger } from "fastify";
import type { MediaImageUploadResponse } from "shared";
import {
  MediaProcessingError,
  processRasterImage,
} from "./imagePipeline.js";
import { mediaStorageConfigured } from "./mediaConfig.js";
import { buildMediaImageResponse, uploadRasterSet } from "./mediaStorage.js";

export type MediaUploadResult =
  | { ok: true; data: MediaImageUploadResponse }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export async function runMediaImageUpload(
  buffer: Buffer,
  log: FastifyBaseLogger
): Promise<MediaUploadResult> {
  if (!mediaStorageConfigured()) {
    return {
      ok: false,
      status: 503,
      code: "media_unconfigured",
      message:
        "Загрузка изображений не настроена (S3 / MEDIA_PUBLIC_BASE_URL / ключи AWS).",
    };
  }

  const started = performance.now();

  let processed;
  try {
    processed = await processRasterImage(buffer);
  } catch (e) {
    if (e instanceof MediaProcessingError) {
      return {
        ok: false,
        status: 400,
        code: e.code,
        message: e.message,
      };
    }
    log.warn({ err: e }, "media_process_failed");
    return {
      ok: false,
      status: 422,
      code: "process_failed",
      message: "Не удалось обработать изображение. Попробуйте другой файл.",
    };
  }

  try {
    await uploadRasterSet(processed.contentHash, processed.variants);
  } catch (e) {
    log.error({ err: e }, "media_s3_upload_failed");
    return {
      ok: false,
      status: 503,
      code: "storage_failed",
      message: "Не удалось сохранить файлы в хранилище.",
    };
  }

  const processMs = Math.round(performance.now() - started);
  if (processMs > 2000) {
    log.warn({ ms: processMs, hash: processed.contentHash }, "media_process_slow");
  }

  const meta = buildMediaImageResponse(processed.contentHash);
  const data: MediaImageUploadResponse = {
    ...meta,
    lqipDataUrl: processed.lqipDataUrl,
    processMs,
  };
  return { ok: true, data };
}
