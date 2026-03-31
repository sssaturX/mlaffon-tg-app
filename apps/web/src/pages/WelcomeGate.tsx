import { Gift, Trophy, Zap } from "lucide-react";
import WebApp from "@twa-dev/sdk";
import type { MeResponse } from "shared";
import { useOAuthLink } from "../hooks/useOAuthLink";

const creatorName =
  import.meta.env.VITE_CREATOR_DISPLAY_NAME?.trim() || "Стример";
const creatorAvatar = import.meta.env.VITE_CREATOR_AVATAR_URL?.trim() || "";
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

export default function WelcomeGate({
  me,
  onRefresh,
}: {
  me: MeResponse;
  onRefresh: () => void;
}) {
  const { startOAuth, connectStub, stub } = useOAuthLink(onRefresh);

  const helloName =
    me.firstName?.trim() ||
    (me.username ? `@${me.username}` : "друг");

  const userLabel =
    me.firstName?.trim() ||
    (me.username ? `@${me.username}` : "Игрок");
  const userHandle = me.username ? `@${me.username}` : `id ${me.telegramId.slice(0, 8)}…`;

  return (
    <div className="welcome-gate">
      <div className="welcome-gate__scroll">
        <div className="card welcome-gate__creator">
          <div className="welcome-gate__creator-row">
            {creatorAvatar ? (
              <img
                src={creatorAvatar}
                alt=""
                className="welcome-gate__avatar welcome-gate__avatar--lg"
                loading="lazy"
              />
            ) : (
              <div
                className="welcome-gate__avatar welcome-gate__avatar--lg welcome-gate__avatar--ph"
                aria-hidden
              />
            )}
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
            {me.photoUrl ? (
              <img
                src={me.photoUrl}
                alt=""
                className="welcome-gate__avatar"
                loading="lazy"
              />
            ) : (
              <div
                className="welcome-gate__avatar welcome-gate__avatar--ph"
                aria-hidden
              />
            )}
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
