import type { FastifyRequest } from "fastify";
import { MAX_ORIGINAL_IMAGE_BYTES } from "../services/mediaConfig.js";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/tiff",
]);

export type MultipartImageReadResult =
  | { ok: true; buffer: Buffer; mime: string }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

type RequestWithMultipartFile = FastifyRequest & {
  file: () => Promise<import("@fastify/multipart").MultipartFile | undefined>;
};

export async function readMultipartImagePart(
  req: FastifyRequest
): Promise<MultipartImageReadResult> {
  let file: import("@fastify/multipart").MultipartFile | undefined;
  try {
    file = await (req as RequestWithMultipartFile).file();
  } catch {
    return {
      ok: false,
      status: 400,
      code: "multipart_expected",
      message: "Ожидается multipart с полем файла (например file).",
    };
  }

  if (!file) {
    return {
      ok: false,
      status: 400,
      code: "file_required",
      message: "Прикрепите файл в поле file.",
    };
  }

  const mime = (file.mimetype ?? "").toLowerCase();
  if (mime && !ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      status: 400,
      code: "unsupported_type",
      message: `Тип ${mime} не поддержан. Используйте растровое фото (JPEG, PNG, WebP, …).`,
    };
  }

  const chunks: Buffer[] = [];
  for await (const ch of file.file) {
    chunks.push(ch as Buffer);
  }
  const buffer = Buffer.concat(chunks);

  if (buffer.length === 0) {
    return {
      ok: false,
      status: 400,
      code: "empty_file",
      message: "Пустой файл.",
    };
  }

  if (buffer.length > MAX_ORIGINAL_IMAGE_BYTES) {
    return {
      ok: false,
      status: 400,
      code: "file_too_large",
      message: `Максимум ${MAX_ORIGINAL_IMAGE_BYTES / (1024 * 1024)} МБ.`,
    };
  }

  return { ok: true, buffer, mime };
}
