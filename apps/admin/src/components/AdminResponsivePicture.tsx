import { useState, type CSSProperties } from "react";
import type { MediaImageUploadResponse } from "shared";

type Props = {
  image: MediaImageUploadResponse;
  alt: string;
  sizes: string;
  className?: string;
  imgClassName?: string;
  layout?: "intrinsic" | "fill";
  hero?: boolean;
};

/** Тот же контракт, что `apps/web` ResponsivePicture: picture + AVIF/WebP/JPEG. */
export function AdminResponsivePicture({
  image,
  alt,
  sizes,
  className,
  imgClassName,
  layout = "intrinsic",
  hero = false,
}: Props) {
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
