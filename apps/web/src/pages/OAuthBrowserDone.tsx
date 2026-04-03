import { CheckCircle2, ExternalLink, MessageCircle, XCircle } from "lucide-react";
import { useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { getBotUsername } from "../botUsername";
import { formatOAuthRedirectError } from "../utils/userFacingMessages";

/**
 * Показ во внешнем браузере после OAuth: токена нет (открыли Twitch/Kick не из WebView мини-аппа).
 * Объясняем, что подключение прошло, и даём ссылку вернуться в Telegram.
 */
export default function OAuthBrowserDone() {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const p =
    /\/oauth\/kick/.test(location.pathname) ? "kick" : "twitch";
  const name = p === "kick" ? "Kick" : "Twitch";
  const connected = searchParams.get("connected") === "1";
  const errRaw = searchParams.get("error");

  const bot = getBotUsername();
  const tme = `https://t.me/${bot}`;

  const errText = useMemo(() => {
    if (!errRaw) return null;
    try {
      return formatOAuthRedirectError(decodeURIComponent(errRaw));
    } catch {
      return formatOAuthRedirectError(errRaw);
    }
  }, [errRaw]);

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
              Авторизация прошла успешно. Сессия мини-приложения остаётся в Telegram — вернитесь в
              чат с ботом и снова откройте приложение: баланс и профиль обновятся автоматически.
            </p>
            <a href={tme} className="primary oauth-browser-done__cta" target="_blank" rel="noopener noreferrer">
              <MessageCircle size={20} aria-hidden />
              Открыть бота в Telegram
            </a>
            <a
              href={tme}
              className="oauth-browser-done__link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} aria-hidden />
              t.me/{bot}
            </a>
            <p className="muted oauth-browser-done__hint">
              Если окно закроется — найдите бота в Telegram и нажмите «Menu» / «Открыть приложение».
            </p>
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
            <a href={tme} className="primary oauth-browser-done__cta" target="_blank" rel="noopener noreferrer">
              <MessageCircle size={20} aria-hidden />
              Перейти к боту
            </a>
          </div>
        </main>
      </div>
    );
  }

  return null;
}
