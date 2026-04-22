import { parseMediaImageUploadResponse, type MediaImageUploadResponse } from "shared";

export function withParsedGiveawayImageMedia<T extends { imageMedia?: unknown }>(
  row: T
): Omit<T, "imageMedia"> & { imageMedia?: MediaImageUploadResponse } {
  const parsed = parseMediaImageUploadResponse(row.imageMedia);
  const { imageMedia: _omit, ...rest } = row;
  return { ...rest, ...(parsed ? { imageMedia: parsed } : {}) } as Omit<
    T,
    "imageMedia"
  > & { imageMedia?: MediaImageUploadResponse };
}
