/**
 * Загрузка локального файла через тот же пайплайн, что и HTTP-эндпоинт.
 *
 * Usage (из каталога apps/api):
 *   npx tsx src/scripts/uploadMedia.ts path/to/photo.jpg
 *
 * Требуются переменные окружения для S3 (см. deploy/IMAGES.md).
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { processRasterImage } from "../services/imagePipeline.js";
import {
  MAX_ORIGINAL_IMAGE_BYTES,
  mediaStorageConfigured,
} from "../services/mediaConfig.js";
import { buildMediaImageResponse, uploadRasterSet } from "../services/mediaStorage.js";

const pathArg = process.argv[2];
if (!pathArg) {
  console.error("Usage: npx tsx src/scripts/uploadMedia.ts <path-to-image>");
  process.exit(1);
}

const buf = await readFile(pathArg);
if (buf.length > MAX_ORIGINAL_IMAGE_BYTES) {
  console.error(`File exceeds ${MAX_ORIGINAL_IMAGE_BYTES} bytes`);
  process.exit(1);
}

const t0 = performance.now();
const processed = await processRasterImage(buf);
const processMs = Math.round(performance.now() - t0);

if (!mediaStorageConfigured()) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        ...buildMediaImageResponse(processed.contentHash),
        lqipDataUrl: processed.lqipDataUrl,
        processMs,
        hint: "Задайте MEDIA_S3_BUCKET, MEDIA_PUBLIC_BASE_URL, AWS keys — для реальной загрузки.",
      },
      null,
      2
    )
  );
  process.exit(0);
}

await uploadRasterSet(processed.contentHash, processed.variants);
console.log(
  JSON.stringify(
    {
      ...buildMediaImageResponse(processed.contentHash),
      lqipDataUrl: processed.lqipDataUrl,
      processMs,
    },
    null,
    2
  )
);
