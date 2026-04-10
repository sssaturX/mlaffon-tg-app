import { CheckCircle2, ExternalLink, Home, MessageCircle, XCircle } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { getBotUsername } from "../botUsername";
import { formatOAuthRedirectError } from "../utils/userFacingMessages";

/**
 * Показ во внешнем браузере после OAuth: токена нет (например открыли провайдера из WebView мини-аппа).
 * По `rc` в URL — вернуть в Telegram или на сайт; из TMA при успехе пробуем авто-редирект в мини-приложение.
 */
export default function OAuthBrowserDone() {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const p =
    /\/oauth\/kick/.test(location.pathname) ? "kick" : "twitch";
  const name = p === "kick" ? "Kick" : "Twitch";
  const connected = searchParams.get("connected") === "1";
  const errRaw = searchParams.get("error");
  /** Явный контекст из API: `web` — поток с сайта, иначе (tma / нет параметра) — из Telegram. */
  const returnWeb = searchParams.get("rc") === "web";

  const bot = getBotUsername();
  const miniAppOpenUrl = useMemo(
    () => `https://t.me/${bot}?startapp=oauth_ok`,
    [bot]
  );
  const siteOrigin =
    typeof window !== "undefined" ? window.location.origin : "";

  const errText = useMemo(() => {
    if (!errRaw) return null;
    try {
      return formatOAuthRedirectError(decodeURIComponent(errRaw));
    } catch {
      return formatOAuthRedirectError(errRaw);
    }
  }, [errRaw]);

  useEffect(() => {
    if (!connected || returnWeb || errRaw) return;
    const t = window.setTimeout(() => {
      window.location.replace(miniAppOpenUrl);
    }, 500);
    return () => clearTimeout(t);
  }, [connected, returnWeb, errRaw, miniAppOpenUrl]);

  if (connected && returnWeb) {
    return (
      <div className="app-shell oauth-browser-done">
        <main className="app-main oauth-browser-done__main">
          <div className="oauth-browser-done__card card">
            <div className="oauth-browser-done__icon-wrap">
              <CheckCircle2 size={48} strokeWidth={1.75} className="oauth-browser-done__ok" />
            </div>
            <h1 className="oauth-browser-done__title">{name} подключён</h1>
            <p className="oauth-browser-done__lead">
              Авторизация прошла успешно. Вернитесь на вкладку с сайтом или откройте приложение снова — сессия
              уже сохранена в этом браузере.
            </p>
            <a href={siteOrigin || "/"} className="primary oauth-browser-done__cta">
              <Home size={20} aria-hidden />
              Открыть сайт
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (connected) {
    return (
      <div className="app-shell oauth-browser-done">
        <main className="app-main oauth-browser-done__main">
          <div className="oauth-browser-done__card card">
            <div className="oauth-browser-done__icon-wrap">
              <CheckCircle2 size={48} strokeWidth={1.75} className="oauth-browser-done__ok" />
            </div>
            <h1 className="oauth-browser-done__title">{name} подключён</h1>
            <p className="oauth-browser-done__lead">
              Сейчас откроется Telegram с мини-приложением. Если этого не произошло — нажмите кнопку ниже.
            </p>
            <a href={miniAppOpenUrl} className="primary oauth-browser-done__cta">
              <MessageCircle size={20} aria-hidden />
              Открыть мини-приложение
            </a>
            <a
              href={miniAppOpenUrl}
              className="oauth-browser-done__link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} aria-hidden />
              t.me/{bot}
            </a>
            <p className="muted oauth-browser-done__hint">
              Сессия мини-приложения остаётся в Telegram — после возврата профиль и баланс обновятся автоматически.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (errText && returnWeb) {
    return (
      <div className="app-shell oauth-browser-done">
        <main className="app-main oauth-browser-done__main">
          <div className="oauth-browser-done__card card">
            <div className="oauth-browser-done__icon-wrap oauth-browser-done__icon-wrap--err">
              <XCircle size={48} strokeWidth={1.75} />
            </div>
            <h1 className="oauth-browser-done__title">Не удалось подключить {name}</h1>
            <p className="err oauth-browser-done__err">{errText}</p>
            <p className="muted oauth-browser-done__lead">
              Закройте эту вкладку и попробуйте снова на сайте.
            </p>
            <a href={siteOrigin || "/"} className="primary oauth-browser-done__cta">
              <Home size={20} aria-hidden />
              На сайт
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (errText) {
    return (
      <div className="app-shell oauth-browser-done">
        <main className="app-main oauth-browser-done__main">
          <div className="oauth-browser-done__card card">
            <div className="oauth-browser-done__icon-wrap oauth-browser-done__icon-wrap--err">
              <XCircle size={48} strokeWidth={1.75} />
            </div>
            <h1 className="oauth-browser-done__title">Не удалось подключить {name}</h1>
            <p className="err oauth-browser-done__err">{errText}</p>
            <p className="muted oauth-browser-done__lead">
              Закройте эту вкладку и попробуйте снова из мини-приложения в Telegram.
            </p>
            <a href={miniAppOpenUrl} className="primary oauth-browser-done__cta">
              <MessageCircle size={20} aria-hidden />
              Открыть мини-приложение
            </a>
          </div>
        </main>
      </div>
    );
  }

  return null;
}
