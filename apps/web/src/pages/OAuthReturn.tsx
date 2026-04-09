import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { MeResponse } from "shared";
import { AppLoadingSpinner } from "../components/AppLoadingSpinner";
import { hasLinkedStreamingAccount } from "../utils/streamingAccount";
import { hydrateMeThroughEventBus } from "../meDomain/meHydration";

export const OAUTH_TOAST_KEY = "mlaffon_oauth_toast";

async function syncUntilLinked(): Promise<MeResponse | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const m = await hydrateMeThroughEventBus();
    if (m && hasLinkedStreamingAccount(m)) return m;
    await new Promise((r) => setTimeout(r, 120 + attempt * 40));
  }
  return hydrateMeThroughEventBus();
}

/**
 * Редирект после OAuth — гидратация через шину `me:update`, затем навигация.
 */
export default function OAuthReturn() {
  const { platform } = useParams<{ platform: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connected = searchParams.get("connected");
  const err = searchParams.get("error");

  useEffect(() => {
    let cancelled = false;
    const p = platform === "kick" ? "kick" : "twitch";

    void (async () => {
      if (connected === "1") {
        await syncUntilLinked();
        if (cancelled) return;
        try {
          sessionStorage.setItem(OAUTH_TOAST_KEY, p);
        } catch {
          /* ignore */
        }
        navigate("/", { replace: true });
        return;
      }

      if (err) {
        const qs = new URLSearchParams();
        qs.set("oauth_err", err);
        await hydrateMeThroughEventBus();
        if (cancelled) return;
        navigate(`/profile?${qs.toString()}`, { replace: true });
        return;
      }

      await hydrateMeThroughEventBus();
      if (cancelled) return;
      navigate("/profile", { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [platform, connected, err, navigate]);

  return <AppLoadingSpinner />;
}
