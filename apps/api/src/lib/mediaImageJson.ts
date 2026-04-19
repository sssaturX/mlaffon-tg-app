import { z } from "zod";

/** Валидация объекта, сохранённого в meta / JSONB (ответ пайплайна медиа). */
export const mediaImageUploadResponseSchema = z.object({
  hash: z.string(),
  basePath: z.string(),
  widths: z.array(z.number()),
  urlsByWidth: z.record(
    z.string(),
    z.object({
      avif: z.string(),
      webp: z.string(),
      jpeg: z.string(),
    })
  ),
  srcset: z.object({
    avif: z.string(),
    webp: z.string(),
    jpeg: z.string(),
  }),
  fallbackSrc: z.string(),
  lqipDataUrl: z.string(),
  processMs: z.number(),
});

export type StoredMediaImage = z.infer<typeof mediaImageUploadResponseSchema>;

export function parseStoredMediaImage(v: unknown): StoredMediaImage | null {
  const r = mediaImageUploadResponseSchema.safeParse(v);
  return r.success ? r.data : null;
}
