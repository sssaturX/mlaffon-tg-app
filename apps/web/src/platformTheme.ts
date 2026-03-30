import type { MeResponse } from "shared";

export type PlatformTheme = "default" | "twitch" | "kick";

/** Базовая синяя тема — нет OAuth или подключены оба сервиса. */
export function getPlatformTheme(me: MeResponse | null): PlatformTheme {
  if (!me) return "default";
  const t = me.platforms.twitch === "connected";
  const k = me.platforms.kick === "connected";
  if (t && k) return "default";
  if (t) return "twitch";
  if (k) return "kick";
  return "default";
}
