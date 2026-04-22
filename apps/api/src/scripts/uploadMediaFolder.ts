/**
 * Пакетная загрузка картинок из папки — по одному файлу, с паузой между ними (меньше пиков CPU/S3).
 *
 * Из каталога apps/api:
 *   npx tsx src/scripts/uploadMediaFolder.ts "C:\path\to\folder"
 *   npm run upload:media-folder -- "C:\Users\...\Новая папка"
 *
 * Опции:
 *   --delay-ms=800     пауза между файлами (по умолчанию 500)
 *   --out=results.json итог: JSON-массив { file, ok, fallbackSrc?, hash?, error?, processMs? }
 *
 * Без S3 в .env — как uploadMedia.ts: dryRun, в бакет не пишет.
 *
 * Требуются переменные: см. deploy/IMAGES.md
 */
import "dotenv/config";
import { readdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  MediaProcessingError,
  processRasterImage,
} from "../services/imagePipeline.js";
import {
  MAX_ORIGINAL_IMAGE_BYTES,
  mediaStorageConfigured,
} from "../services/mediaConfig.js";
import { buildMediaImageResponse, uploadRasterSet } from "../services/mediaStorage.js";

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".heic",
  ".heif",
]);

/** Как ответ одиночного uploadMedia.ts — удобно копировать в админку как imageMedia + imageUrl. */
type MediaUploadPayload = ReturnType<typeof buildMediaImageResponse> & {
  lqipDataUrl: string;
  processMs: number;
};

type Row =
  | {
      file: string;
      ok: true;
      hash: string;
      fallbackSrc: string;
      processMs: number;
      dryRun?: boolean;
      /** Полный JSON для админки / API */
      media: MediaUploadPayload;
    }
  | {
      file: string;
      ok: false;
      error: string;
    };

function parseArgs(argv: string[]): {
  dir: string;
  delayMs: number;
  outPath: string | null;
} {
  let dir = "";
  let delayMs = 500;
  let outPath: string | null = null;
  for (const a of argv) {
    if (a.startsWith("--delay-ms=")) {
      const n = Number(a.slice("--delay-ms=".length));
      if (Number.isFinite(n) && n >= 0) delayMs = n;
      continue;
    }
    if (a.startsWith("--out=")) {
      outPath = a.slice("--out=".length).trim() || null;
      continue;
    }
    if (!a.startsWith("--") && !dir) {
      dir = a;
    }
  }
  return { dir, delayMs, outPath };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function processOneFile(absPath: string, dryRun: boolean): Promise<Row> {
  const file = basename(absPath);
  let buf: Buffer;
  try {
    buf = await readFile(absPath);
  } catch (e) {
    return {
      file,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (buf.length > MAX_ORIGINAL_IMAGE_BYTES) {
    return {
      file,
      ok: false,
      error: `Файл больше ${MAX_ORIGINAL_IMAGE_BYTES} байт`,
    };
  }
  const t0 = performance.now();
  let processed;
  try {
    processed = await processRasterImage(buf);
  } catch (e) {
    if (e instanceof MediaProcessingError) {
      return { file, ok: false, error: e.message };
    }
    return {
      file,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const processMs = Math.round(performance.now() - t0);
  const meta = buildMediaImageResponse(processed.contentHash);
  const media: MediaUploadPayload = {
    ...meta,
    lqipDataUrl: processed.lqipDataUrl,
    processMs,
  };

  if (!dryRun) {
    try {
      await uploadRasterSet(processed.contentHash, processed.variants);
    } catch (e) {
      return {
        file,
        ok: false,
        error: e instanceof Error ? e.message : "S3 upload failed",
      };
    }
  }

  return {
    file,
    ok: true,
    hash: processed.contentHash,
    fallbackSrc: meta.fallbackSrc,
    processMs,
    ...(dryRun ? { dryRun: true as const } : {}),
    media,
  };
}

const { dir: dirRaw, delayMs, outPath } = parseArgs(process.argv.slice(2));

if (!dirRaw) {
  console.error(`
Usage (из apps/api):
  npx tsx src/scripts/uploadMediaFolder.ts <путь-к-папке> [--delay-ms=500] [--out=results.json]

Пример:
  npx tsx src/scripts/uploadMediaFolder.ts "C:\\Users\\you\\Downloads\\Telegram Desktop\\Новая папка\\Новая папка"
`);
  process.exit(1);
}

const dir = resolve(dirRaw);
const dryRun = !mediaStorageConfigured();

let entries: string[];
try {
  entries = await readdir(dir);
} catch (e) {
  console.error(
    "Не удалось прочитать папку:",
    e instanceof Error ? e.message : e
  );
  process.exit(1);
}

const files = entries
  .filter((name) => IMAGE_EXT.has(extname(name).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  .map((name) => join(dir, name));

if (files.length === 0) {
  console.error("В папке нет поддерживаемых изображений:", [...IMAGE_EXT].join(", "));
  process.exit(1);
}

if (dryRun) {
  console.error(
    "[dry-run] S3 не настроен — только обработка Sharp, без загрузки. Задайте MEDIA_S3_* и AWS_* в apps/api/.env\n"
  );
} else {
  console.error(
    `[upload] Папка: ${dir}\n[upload] Файлов: ${files.length}, пауза ${delayMs} ms между файлами\n`
  );
}

const rows: Row[] = [];
for (let i = 0; i < files.length; i++) {
  const abs = files[i]!;
  const name = basename(abs);
  process.stderr.write(`[${i + 1}/${files.length}] ${name} … `);
  const row = await processOneFile(abs, dryRun);
  rows.push(row);
  if (row.ok) {
    console.error(`OK ${row.processMs}ms`);
    console.error(`    ${row.fallbackSrc}\n`);
  } else {
    console.error(`ОШИБКА: ${row.error}\n`);
  }
  if (i < files.length - 1 && delayMs > 0) {
    await sleep(delayMs);
  }
}

if (outPath) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outPath, JSON.stringify(rows, null, 2), "utf8");
  console.error(`Результаты записаны: ${resolve(outPath)}`);
}

const okN = rows.filter((r) => r.ok).length;
console.error(`Готово: ${okN}/${rows.length} успешно.`);

process.exit(okN === rows.length ? 0 : 1);
