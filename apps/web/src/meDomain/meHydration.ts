import { splitMeResponse, type MeResponse } from "shared";
import { formatApiError, getToken, setToken } from "../api";
import { ApiQueryError } from "../query/apiQueryError";
import { fetchMe } from "../query/fetchers";
import { getMeFromCache } from "../hooks/queries/useMergedMe";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "./domainVersion";

type ShowToast = (
  message: string,
  variant?: "info" | "success" | "error",
  third?: number | { durationMs?: number; streak?: boolean }
) => void;

/**
 * Bootstrap / retry / OAuth: параллельный HTTP → только через `me:update` snapshot.
 * Не пишет кэш напрямую.
 */
export async function hydrateMeThroughEventBus(
  showToast?: ShowToast
): Promise<MeResponse | null> {
  if (!getToken()) {
    appEventBus.emit("me:update", { kind: "clear", reason: "logout" });
    return null;
  }

  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;

  try {
    const me = await fetchMe();
    const { profile, economy } = splitMeResponse(me);
    appEventBus.emit("me:update", {
      kind: "http_snapshot",
      source: "http",
      profile,
      economy,
      profileV0,
      economyV0,
    });
    return getMeFromCache();
  } catch (e) {
    if (e instanceof ApiQueryError) {
      const r = e.apiErr;
      if (r.networkError) {
        showToast?.(formatApiError(r), "error");
        return getMeFromCache();
      }
      appEventBus.emit("me:update", { kind: "clear", reason: "auth_error" });
      setToken(null);
      showToast?.(formatApiError(r), "error");
      return null;
    }
    throw e;
  }
}
