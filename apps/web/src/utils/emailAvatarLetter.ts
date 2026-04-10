/**
 * Одна буква/символ для аватара по email, если нет фото профиля (веб-регистрация).
 */
export function emailAvatarLetter(
  photoUrl: string | null | undefined,
  email: string | null | undefined
): string | undefined {
  if (photoUrl?.trim()) return undefined;
  const e = email?.trim();
  if (!e) return undefined;
  const first = [...e][0];
  if (!first) return undefined;
  return first.toLocaleUpperCase("ru-RU");
}
