import { ChevronLeft, Gift, Trophy, Zap } from "lucide-react";
import { TelegramWebApp as WebApp } from "../lib/telegramAdapter";
import type { MeResponse } from "shared";
import { setToken } from "../api";
import { useOAuthLink } from "../hooks/useOAuthLink";
import { appEventBus } from "../events/appEventBus";
import { looksLikeTelegramMiniApp } from "../utils/waitForTelegramInitData";
import { UserPhotoAvatar } from "../components/UserPhotoAvatar";
import { emailAvatarLetter } from "../utils/emailAvatarLetter";

const creatorName =
  import.meta.env.VITE_CREATOR_DISPLAY_NAME?.trim() || "MlaffonXD";
const creatorAvatar =
  import.meta.env.VITE_CREATOR_AVATAR_URL?.trim() || "/streamer-kick.jpg";
const creatorKickLabel =
  import.meta.env.VITE_CREATOR_KICK_LABEL?.trim() || "Kick";
const creatorKickUrl = import.meta.env.VITE_CREATOR_KICK_PAGE_URL?.trim() || "";

const greetingBody =
  import.meta.env.VITE_CREATOR_GREETING?.trim() ||
  "Я создал это приложение специально для своих зрителей — смотри мои стримы, выполняй задания и получай призы.";

function openExternal(url: string) {
  try {
    if (WebApp.initData && typeof WebApp.openLink === "function") {
      WebApp.openLink(url);
      return;
    }
  } catch {
    /* ignore */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function WelcomeGate({ me }: { me: MeResponse }) {
  const { startOAuth, connectStub, stub } = useOAuthLink();

  /** В браузере — выйти на экран входа другим аккаунтом; в Telegram Mini App не показываем. */
  const showBackToLogin =
    import.meta.env.VITE_ALLOW_WEB_AUTH !== "0" && !looksLikeTelegramMiniApp();

  function exitToLogin() {
    setToken(null);
    appEventBus.emit("me:update", { kind: "clear", reason: "logout" });
    window.location.reload();
  }

  const helloName =
    me.firstName?.trim() ||
    (me.username ? `@${me.username}` : "друг");

  const userLabel =
    me.firstName?.trim() ||
    (me.username ? `@${me.username}` : "Игрок");
  const userHandle =
    me.username
      ? `@${me.username}`
      : me.telegramId != null
        ? `id ${me.telegramId.slice(0, 8)}…`
        : me.email ?? "—";

  return (
    <div className="welcome-gate">
      {showBackToLogin ? (
        <div className="welcome-gate__topbar">
          <button
            type="button"
            className="welcome-gate__back"
            onClick={exitToLogin}
            aria-label="Выйти и войти другим аккаунтом"
          >
            <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="welcome-gate__scroll">
        <div className="card welcome-gate__creator">
          <div className="welcome-gate__creator-row">
            <UserPhotoAvatar
              src={creatorAvatar}
              className="welcome-gate__avatar welcome-gate__avatar--lg"
              placeholderClassName="welcome-gate__avatar--ph"
            />
            <div className="welcome-gate__creator-meta">
              <div className="welcome-gate__creator-name">{creatorName}</div>
              {creatorKickUrl ? (
                <button
                  type="button"
                  className="welcome-gate__kick-link"
                  onClick={() => openExternal(creatorKickUrl)}
                >
                  {creatorKickLabel}
                </button>
              ) : (
                <span className="welcome-gate__kick-link welcome-gate__kick-link--static">
                  {creatorKickLabel}
                </span>
              )}
            </div>
          </div>
          <p className="welcome-gate__greeting">
            Привет, {helloName}! {greetingBody}
          </p>
        </div>

        <div className="card welcome-gate__user">
          <div className="welcome-gate__creator-row">
            <UserPhotoAvatar
              src={me.photoUrl}
              className="welcome-gate__avatar"
              placeholderClassName="welcome-gate__avatar--ph"
              fallbackLetter={emailAvatarLetter(me.photoUrl, me.email)}
            />
            <div className="welcome-gate__creator-meta">
              <div className="welcome-gate__user-name">{userLabel}</div>
              <div className="welcome-gate__user-handle muted">{userHandle}</div>
            </div>
          </div>
        </div>

        <div className="welcome-gate__features">
          <div className="card welcome-gate__feature">
            <Zap className="welcome-gate__feature-icon" size={22} aria-hidden />
            <div>
              <div className="welcome-gate__feature-title">Выполняй задания</div>
              <p className="welcome-gate__feature-desc muted">
                Зарабатывай монеты за участие в стримах
              </p>
            </div>
          </div>
          <div className="card welcome-gate__feature">
            <Gift className="welcome-gate__feature-icon" size={22} aria-hidden />
            <div>
              <div className="welcome-gate__feature-title">Получай призы</div>
              <p className="welcome-gate__feature-desc muted">
                Обменивай монеты на различные призы
              </p>
            </div>
          </div>
          <div className="card welcome-gate__feature">
            <Trophy className="welcome-gate__feature-icon" size={22} aria-hidden />
            <div>
              <div className="welcome-gate__feature-title">Участвуй в розыгрышах</div>
              <p className="welcome-gate__feature-desc muted">
                Выигрывай эксклюзивные награды
              </p>
            </div>
          </div>
        </div>

        <p className="welcome-gate__hint muted">
          Чтобы начать, привяжите аккаунт Kick или Twitch
        </p>

        <div className="welcome-gate__actions">
          <button
            type="button"
            className="welcome-gate__btn welcome-gate__btn--kick"
            onClick={() => void startOAuth("kick")}
          >
            Привязать Kick
          </button>
          <button
            type="button"
            className="welcome-gate__btn welcome-gate__btn--twitch"
            onClick={() => void startOAuth("twitch")}
          >
            Привязать Twitch
          </button>
        </div>

        {stub ? (
          <p className="welcome-gate__stub muted">
            Dev:{" "}
            <button type="button" className="link-like" onClick={() => void connectStub("kick")}>
              stub Kick
            </button>
            {" · "}
            <button type="button" className="link-like" onClick={() => void connectStub("twitch")}>
              stub Twitch
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
