import type { FastifyRequest } from "fastify";

export const MAX_OBS_WIDGET_SOUND_BYTES = 2 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/aac",
  "audio/mp4",
]);

const MIME_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
};

export type MultipartSoundReadResult =
  | { ok: true; buffer: Buffer; mime: string; ext: string }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

type RequestWithMultipartFile = FastifyRequest & {
  file: () => Promise<import("@fastify/multipart").MultipartFile | undefined>;
};

export async function readMultipartSoundPart(
  req: FastifyRequest
): Promise<MultipartSoundReadResult> {
  let file: import("@fastify/multipart").MultipartFile | undefined;
  try {
    file = await (req as RequestWithMultipartFile).file();
  } catch {
    return {
      ok: false,
      status: 400,
      code: "multipart_expected",
      message: "Ожидается multipart с полем file.",
    };
  }

  if (!file) {
    return {
      ok: false,
      status: 400,
      code: "file_required",
      message: "Прикрепите аудиофайл в поле file.",
    };
  }

  const mime = (file.mimetype ?? "").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      status: 400,
      code: "unsupported_type",
      message: "Поддерживаются MP3, WAV, OGG, WebM, AAC или M4A.",
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

  if (buffer.length > MAX_OBS_WIDGET_SOUND_BYTES) {
    return {
      ok: false,
      status: 400,
      code: "file_too_large",
      message: "Максимум 2 МБ.",
    };
  }

  return { ok: true, buffer, mime, ext: MIME_EXT[mime] ?? "mp3" };
}
