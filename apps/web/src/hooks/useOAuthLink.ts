import WebApp from "@twa-dev/sdk";
import { api, formatApiError } from "../api";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { useToast } from "../context/ToastContext";

export function useOAuthLink() {
  const { showToast } = useToast();
  const { refreshMe } = useMeEconomySync();

  async function startOAuth(platform: "twitch" | "kick") {
    const path =
      platform === "twitch"
        ? "/api/v1/oauth/twitch/url"
        : "/api/v1/oauth/kick/url";
    const r = await api<{ url: string }>(path);
    if (!r.ok) {
      showToast(formatApiError(r), "error");
      return;
    }
    const url = r.data.url;
    if (WebApp.initData) {
      WebApp.openLink(url);
    } else {
      window.location.href = url;
    }
  }

  async function connectStub(platform: "twitch" | "kick") {
    const r = await api(`/api/v1/platforms/${platform}/connect`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (r.ok) {
      showToast(
        import.meta.env.DEV ? "Тестовое подключение выполнено" : "Подключено",
        "success"
      );
      void refreshMe();
    } else showToast(formatApiError(r), "error");
  }

  const stub =
    import.meta.env.DEV && import.meta.env.VITE_ALLOW_DEV_STUB === "1";

  return { startOAuth, connectStub, stub };
}
