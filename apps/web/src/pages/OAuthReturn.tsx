import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppLoadingSpinner } from "../components/AppLoadingSpinner";

/**
 * Редирект после OAuth на наш домен: /oauth/twitch?connected=1 или ?error=...
 * Дальше — /profile?oauth_ok=… — тост и refresh в Profile.
 */
export default function OAuthReturn({
  onRefresh,
}: {
  onRefresh: () => void;
}) {
  const { platform } = useParams<{ platform: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const p = platform === "kick" ? "kick" : "twitch";
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");

    const qs = new URLSearchParams();
    if (connected === "1") qs.set("oauth_ok", p);
    else if (err) qs.set("oauth_err", err);

    const tail = qs.toString();
    const path = tail ? `/profile?${tail}` : "/profile";

    void (async () => {
      await onRefresh();
      navigate(path, { replace: true });
    })();
  }, [platform, searchParams, navigate, onRefresh]);

  return <AppLoadingSpinner />;
}
