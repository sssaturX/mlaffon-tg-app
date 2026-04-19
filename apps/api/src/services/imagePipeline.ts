import crypto from "node:crypto";
import sharp from "sharp";
import {
  IMAGE_WIDTHS,
  MAX_ORIGINAL_IMAGE_BYTES,
  MAX_VARIANT_BYTES,
  type ImageWidth,
} from "./mediaConfig.js";

export class MediaProcessingError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MediaProcessingError";
  }
}

export type RasterVariantBuffers = {
  width: ImageWidth;
  avif: Buffer;
  webp: Buffer;
  jpeg: Buffer;
};

export type ProcessedRasterImage = {
  contentHash: string;
  lqipDataUrl: string;
  variants: RasterVariantBuffers[];
};

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function toFormatUnderBudget(
  createPipeline: () => sharp.Sharp,
  format: "avif" | "webp" | "jpeg",
  initialQ: number,
  minQ: number
): Promise<Buffer> {
  let q = initialQ;
  let last = Buffer.alloc(0);
  while (q >= minQ) {
    const pipeline = createPipeline();
    if (format === "avif") {
      last = Buffer.from(await pipeline.avif({ quality: q, effort: 4 }).toBuffer());
    } else if (format === "webp") {
      last = Buffer.from(await pipeline.webp({ quality: q }).toBuffer());
    } else {
      last = Buffer.from(
        await pipeline.jpeg({ quality: q, mozjpeg: true }).toBuffer()
      );
    }
    if (last.length <= MAX_VARIANT_BYTES) return last;
    q -= 5;
  }
  if (last.length > MAX_VARIANT_BYTES && format === "avif") {
    let q2 = minQ - 5;
    while (q2 >= 25) {
      const pipeline = createPipeline();
      last = Buffer.from(await pipeline.avif({ quality: q2, effort: 3 }).toBuffer());
      if (last.length <= MAX_VARIANT_BYTES) return last;
      q2 -= 5;
    }
  }
  return last;
}

async function buildLqip(input: Buffer): Promise<string> {
  const buf = Buffer.from(
    await sharp(input, { pages: 1 })
      .rotate()
      .resize(24, 24, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 18 })
      .toBuffer()
  );
  return `data:image/webp;base64,${buf.toString("base64")}`;
}

/**
 * Принимает растровый оригинал, отдаёт варианты AVIF/WebP/JPEG по ширинам и LQIP (data URL).
 * SVG и прочий вектор — отклоняются (иконки хранить отдельно как статические SVG).
 */
export async function processRasterImage(
  input: Buffer
): Promise<ProcessedRasterImage> {
  if (input.length > MAX_ORIGINAL_IMAGE_BYTES) {
    throw new MediaProcessingError(
      "file_too_large",
      `Файл больше ${MAX_ORIGINAL_IMAGE_BYTES / (1024 * 1024)} МБ`
    );
  }

  const probe = sharp(input, {
    pages: 1,
    limitInputPixels: 4096 * 4096,
    failOn: "truncated",
  });
  const meta = await probe.metadata();

  if (meta.format === "svg") {
    throw new MediaProcessingError(
      "svg_not_supported",
      "SVG загружайте как статический ассет; этот эндпоинт только для фото."
    );
  }

  const contentHash = sha256Hex(input);
  const lqipDataUrl = await buildLqip(input);

  const variants: RasterVariantBuffers[] = [];

  for (const w of IMAGE_WIDTHS) {
    const createResized = () =>
      sharp(input, { pages: 1, limitInputPixels: 4096 * 4096 })
        .rotate()
        .resize(w, undefined, {
          fit: "inside",
          withoutEnlargement: true,
        });

    const [avif, webp, jpeg] = await Promise.all([
      toFormatUnderBudget(createResized, "avif", 52, 40),
      toFormatUnderBudget(createResized, "webp", 70, 60),
      toFormatUnderBudget(createResized, "jpeg", 74, 62),
    ]);

    variants.push({ width: w, avif, webp, jpeg });
  }

  return { contentHash, lqipDataUrl, variants };
}
