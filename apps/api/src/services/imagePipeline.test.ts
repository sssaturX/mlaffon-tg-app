import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MediaProcessingError, processRasterImage } from "./imagePipeline.js";

describe("processRasterImage", () => {
  it("строит варианты и LQIP для JPEG", async () => {
    const input = await sharp({
      create: {
        width: 900,
        height: 700,
        channels: 3,
        background: { r: 80, g: 120, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    const r = await processRasterImage(input);
    expect(r.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.lqipDataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    expect(r.variants).toHaveLength(4);
    for (const v of r.variants) {
      expect(v.avif.length).toBeGreaterThan(0);
      expect(v.webp.length).toBeGreaterThan(0);
      expect(v.jpeg.length).toBeGreaterThan(0);
    }
  });

  it("отклоняет SVG", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>`
    );
    await expect(processRasterImage(svg)).rejects.toThrow(MediaProcessingError);
  });
});
