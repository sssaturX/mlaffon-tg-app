import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { MeResponse } from "shared";
import { AppLoadingSpinner } from "../components/AppLoadingSpinner";
import { hasLinkedStreamingAccount } from "../utils/streamingAccount";

export const OAUTH_TOAST_KEY = "mlaffon_oauth_toast";

async function refreshUntilLinked(
  onRefresh: () => Promise<MeResponse | null>,
): Promise<MeResponse | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const m = await onRefresh();
    if (m && hasLinkedStreamingAccount(m)) return m;
    await new Promise((r) => setTimeout(r, 120 + attempt * 40));
  }
  return onRefresh();
}

/**
 * Редирект после OAuth на /oauth/twitch|kick?connected=1 — обновляем /me (с повтором),
 * затем сразу главная + тост (без ручной перезагрузки).
 */
export default function OAuthReturn({
  onRefresh,
}: {
  onRefresh: () => Promise<MeResponse | null>;
}) {
  const { platform } = useParams<{ platform: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const p = platform === "kick" ? "kick" : "twitch";
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");

    void (async () => {
      if (connected === "1") {
        await refreshUntilLinked(onRefresh);
        if (cancelled) return;
        try {
          sessionStorage.setItem(OAUTH_TOAST_KEY, p);
        } catch {
          /* ignore */
        }
        if (cancelled) return;
        navigate("/", { replace: true });
        return;
      }

      if (err) {
        const qs = new URLSearchParams();
        qs.set("oauth_err", err);
        await onRefresh();
        if (cancelled) return;
        navigate(`/profile?${qs.toString()}`, { replace: true });
        return;
      }

      await onRefresh();
      if (cancelled) return;
      navigate("/profile", { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [platform, searchParams, navigate, onRefresh]);

  return <AppLoadingSpinner />;
}
