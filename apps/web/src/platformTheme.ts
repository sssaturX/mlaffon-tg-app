import type { ActivePlatform } from "./context/PlatformContext";

export type PlatformTheme = "default" | "twitch" | "kick";

/** Тема интерфейса следует выбранному в шапке режиму Twitch / Kick. */
export function getPlatformTheme(activePlatform: ActivePlatform): PlatformTheme {
  return activePlatform === "twitch" ? "twitch" : "kick";
}
