import { useState, type CSSProperties } from "react";
import type { MediaImageUploadResponse } from "shared";

export type ResponsivePictureProps = {
  image: MediaImageUploadResponse;
  alt: string;
  /** Например: `(max-width: 640px) 100vw, 640px` — должен соответствовать вёрстке. */
  sizes: string;
  /** LCP / hero: без lazy, с высоким приоритетом загрузки. */
  hero?: boolean;
  /** `fill` — растянуть под контейнер (object-fit: cover), для фонов карточек. */
  layout?: "intrinsic" | "fill";
  className?: string;
  imgClassName?: string;
};

/**
 * `<picture>` + AVIF/WebP/JPEG, lazy/async, progressive через LQIP из ответа API.
 */
export function ResponsivePicture({
  image,
  alt,
  sizes,
  hero = false,
  layout = "intrinsic",
  className,
  imgClassName,
}: ResponsivePictureProps) {
  const [loaded, setLoaded] = useState(false);

  const wrapStyle: CSSProperties =
    layout === "fill"
      ? {
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          background: `center / cover no-repeat url(${image.lqipDataUrl})`,
        }
      : {
          position: "relative",
          overflow: "hidden",
          background: `center / cover no-repeat url(${image.lqipDataUrl})`,
        };

  const imgStyle: CSSProperties =
    layout === "fill"
      ? {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.35s ease-out",
        }
      : {
          display: "block",
          width: "100%",
          height: "auto",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.35s ease-out",
        };

  return (
    <div className={className} style={wrapStyle}>
      <picture style={layout === "fill" ? { display: "block", height: "100%" } : undefined}>
        <source type="image/avif" srcSet={image.srcset.avif} sizes={sizes} />
        <source type="image/webp" srcSet={image.srcset.webp} sizes={sizes} />
        <img
          className={imgClassName}
          src={image.fallbackSrc}
          srcSet={image.srcset.jpeg}
          sizes={sizes}
          alt={alt}
          decoding="async"
          loading={hero ? "eager" : "lazy"}
          fetchPriority={hero ? "high" : undefined}
          onLoad={() => setLoaded(true)}
          style={imgStyle}
        />
      </picture>
    </div>
  );
}
