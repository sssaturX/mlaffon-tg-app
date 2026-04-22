import { resolveAdminImageForPreview } from "shared";
import { AdminResponsivePicture } from "./AdminResponsivePicture";

type Props = {
  imageUrl: string | null | undefined;
  imageMedia: unknown;
  alt: string;
  /** Обертка (например admin-shop-preview--img) */
  className?: string;
  /** Класс для &lt;img&gt; в режиме direct или внутреннего img в picture */
  imgClassName?: string;
  sizes?: string;
};

/**
 * Превью в админке: не использует CDN base path как единственный &lt;img src&gt;.
 */
export function AdminImagePreview({
  imageUrl,
  imageMedia,
  alt,
  className,
  imgClassName,
  sizes = "(max-width: 480px) 100vw, 360px",
}: Props) {
  const r = resolveAdminImageForPreview(imageUrl, imageMedia);
  if (!r) return null;
  if (r.mode === "responsive") {
    return (
      <AdminResponsivePicture
        image={r.media}
        alt={alt}
        sizes={sizes}
        className={className}
        imgClassName={imgClassName}
      />
    );
  }
  return (
    <img
      src={r.src}
      alt={alt}
      className={imgClassName}
      loading="lazy"
      decoding="async"
    />
  );
}
