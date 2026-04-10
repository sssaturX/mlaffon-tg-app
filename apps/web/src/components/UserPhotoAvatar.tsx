import { useCallback, useState } from "react";

type Props = {
  src: string | null | undefined;
  className: string;
  /** Доп. класс для плейсхолдера (нет url или ошибка загрузки), напр. `welcome-gate__avatar--ph`. */
  placeholderClassName?: string;
  /** Если нет фото — показать букву (например первая буква email). */
  fallbackLetter?: string | null;
  alt?: string;
  width?: number;
  height?: number;
};

/**
 * Аватарка профиля: t.me/userpic часто рвётся с таймаутом без no-referrer / вне Telegram WebView.
 */
export function UserPhotoAvatar({
  src,
  className,
  placeholderClassName,
  fallbackLetter,
  alt = "",
  width,
  height,
}: Props) {
  const [broken, setBroken] = useState(false);
  const onError = useCallback(() => setBroken(true), []);

  const letter = fallbackLetter?.trim();

  if (!src?.trim() || broken) {
    if (letter) {
      const cn = [className, "user-photo-avatar--letter"].filter(Boolean).join(" ");
      return (
        <div className={cn} role="img" aria-label={alt || `Аватар: ${letter}`}>
          {letter}
        </div>
      );
    }
    const cn = [className, placeholderClassName].filter(Boolean).join(" ");
    return <div className={cn} aria-hidden />;
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      width={width}
      height={height}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
}
