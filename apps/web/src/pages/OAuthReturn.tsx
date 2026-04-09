import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { MeResponse } from "shared";
import { AppLoadingSpinner } from "../components/AppLoadingSpinner";
import { hasLinkedStreamingAccount } from "../utils/streamingAccount";
import { queryKeys } from "../query/queryKeys";
import { syncMeFromNetwork } from "../services/meService";

export const OAUTH_TOAST_KEY = "mlaffon_oauth_toast";

async function syncUntilLinked(): Promise<MeResponse | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const m = await syncMeFromNetwork();
    if (m && hasLinkedStreamingAccount(m)) return m;
    await new Promise((r) => setTimeout(r, 120 + attempt * 40));
  }
  return syncMeFromNetwork();
}

/**
 * Редирект после OAuth на /oauth/twitch|kick?connected=1 — sync me (с повтором),
 * затем главная + тост через sessionStorage (см. Home).
 */
export default function OAuthReturn() {
  const { platform } = useParams<{ platform: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  /** Каждый заход на маршрут — отдельный запуск (кэш по URL не блокирует повторный OAuth). */
  const [visitNonce] = useState(() => `${Date.now()}-${Math.random()}`);

  const p = platform === "kick" ? "kick" : "twitch";
  const connected = searchParams.get("connected");
  const err = searchParams.get("error");

  useQuery({
    queryKey: [...queryKeys.sync.oauthReturn(p, connected, err), visitNonce],
    queryFn: async () => {
      if (connected === "1") {
        await syncUntilLinked();
        try {
          sessionStorage.setItem(OAUTH_TOAST_KEY, p);
        } catch {
          /* ignore */
        }
        navigate("/", { replace: true });
        return "home";
      }

      if (err) {
        const qs = new URLSearchParams();
        qs.set("oauth_err", err);
        await syncMeFromNetwork();
        navigate(`/profile?${qs.toString()}`, { replace: true });
        return "profile-err";
      }

      await syncMeFromNetwork();
      navigate("/profile", { replace: true });
      return "profile";
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  return <AppLoadingSpinner />;
}
