import { CheckCircle2, ExternalLink, Home, MessageCircle, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { getBotUsername } from "../botUsername";
import { formatOAuthRedirectError } from "../utils/userFacingMessages";

/**
 * Показ во внешнем браузере после OAuth: токена нет.
 *
 * TMA-flow:  WebApp.openLink → OAuth → callback → эта страница.
 *   НЕ делаем автоматический window.location.replace —
 *   на мобильных браузерах после цепочки OAuth-редиректов это нестабильно
 *   и часто блокируется (пользователь «застревает»).
 *   Вместо этого — чёткая страница «Авторизация успешна» + кнопка «Открыть бота».
 *
 * Web-flow:  обычный браузер → OAuth → callback → эта страница (rc=web).
 *   Показываем «вернитесь на вкладку с сайтом» + кнопку.
 */
export default function OAuthBrowserDone() {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const p =
    /\/oauth\/kick/.test(location.pathname) ? "kick" : "twitch";
  const name = p === "kick" ? "Kick" : "Twitch";
  const connected = searchParams.get("connected") === "1";
  const errRaw = searchParams.get("error");
  const returnWeb = searchParams.get("rc") === "web";

  const bot = getBotUsername();
  const botDeepLink = useMemo(
    () => `https://t.me/${bot}?start=auth_success`,
    [bot]
  );
  const miniAppLink = useMemo(
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

  /* ── TMA success ── */
  if (connected && !returnWeb) {
    return (
      <div className="app-shell oauth-browser-done">
        <main className="app-main oauth-browser-done__main">
          <div className="oauth-browser-done__card card">
            <div className="oauth-browser-done__icon-wrap">
              <CheckCircle2 size={48} strokeWidth={1.75} className="oauth-browser-done__ok" />
            </div>
            <h1 className="oauth-browser-done__title">
              {name} подключён
            </h1>
            <p className="oauth-browser-done__lead">
              Авторизация через {name} прошла успешно.
              Вернитесь в Telegram — приложение подхватит привязку автоматически.
            </p>
            <a href={miniAppLink} className="primary oauth-browser-done__cta">
              <MessageCircle size={20} aria-hidden />
              Открыть мини-приложение
            </a>
            <a
              href={botDeepLink}
              className="oauth-browser-done__link"
            >
              <ExternalLink size={16} aria-hidden />
              Открыть бота (@{bot})
            </a>
            <p className="muted oauth-browser-done__hint">
              Можете закрыть эту вкладку — всё сохранено.
            </p>
          </div>
        </main>
      </div>
    );
  }

  /* ── Web success ── */
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

  /* ── TMA error ── */
  if (errText && !returnWeb) {
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
              Вернитесь в Telegram и попробуйте ещё раз из мини-приложения.
            </p>
            <a href={miniAppLink} className="primary oauth-browser-done__cta">
              <MessageCircle size={20} aria-hidden />
              Открыть мини-приложение
            </a>
            <a
              href={botDeepLink}
              className="oauth-browser-done__link"
            >
              <ExternalLink size={16} aria-hidden />
              Открыть бота (@{bot})
            </a>
          </div>
        </main>
      </div>
    );
  }

  /* ── Web error ── */
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

  return null;
}
