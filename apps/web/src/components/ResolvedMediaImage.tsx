import type { ImgHTMLAttributes } from "react";
import type { AdminImagePreviewResolved } from "shared";
import { ResponsivePicture } from "./ResponsivePicture";

export type ResolvedMediaImageProps = {
  resolved: AdminImagePreviewResolved;
  alt: string;
  sizes: string;
  hero?: boolean;
  layout: "intrinsic" | "fill";
  /** Обёртка `<picture>` (например `shop-popup__img--picture`). */
  className?: string;
  imgClassName?: string;
  /** Класс для прямого `<img>` (внешний URL / data URL). */
  directImgClassName?: string;
};

/**
 * После {@link resolveAdminImageForPreview}: CDN base / полный media → ResponsivePicture,
 * иначе обычный img.
 */
export function ResolvedMediaImage({
  resolved,
  alt,
  sizes,
  hero = false,
  layout,
  className,
  imgClassName,
  directImgClassName,
}: ResolvedMediaImageProps) {
  if (resolved.mode === "responsive") {
    return (
      <ResponsivePicture
        image={resolved.media}
        alt={alt}
        sizes={sizes}
        hero={hero}
        layout={layout}
        className={className}
        imgClassName={imgClassName}
      />
    );
  }
  const imgProps: ImgHTMLAttributes<HTMLImageElement> = {
    src: resolved.src,
    alt,
    className: directImgClassName,
    decoding: "async",
    loading: hero ? "eager" : "lazy",
  };
  if (hero) {
    (imgProps as ImgHTMLAttributes<HTMLImageElement> & { fetchPriority?: string }).fetchPriority =
      "high";
  }
  return <img {...imgProps} />;
}
