import WebApp from "@twa-dev/sdk";

const creatorName =
  import.meta.env.VITE_CREATOR_DISPLAY_NAME?.trim() || "Стример";
const creatorAvatar =
  import.meta.env.VITE_CREATOR_AVATAR_URL?.trim() || "";
const creatorKickLabel =
  import.meta.env.VITE_CREATOR_KICK_LABEL?.trim() || "Kick";
const creatorTwitchLabel =
  import.meta.env.VITE_CREATOR_TWITCH_LABEL?.trim() || "Twitch";
const defaultVpnNote =
  import.meta.env.VITE_STREAM_VPN_NOTE?.trim() ||
  "Для захода на стрим может понадобиться VPN.";

export type LiveBroadcastActive = {
  active: true;
  id: string;
  platform: "twitch" | "kick";
  streamUrl: string;
  vpnNote: string | null;
  startedAt: string;
};

/** Вызывать синхронно из обработчика клика — после await Telegram часто блокирует openLink. */
export function openExternal(url: string) {
  const u = url.trim();
  if (!u) return;
  try {
    if (WebApp.initData && typeof WebApp.openLink === "function") {
      WebApp.openLink(u, { try_instant_view: false });
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    window.open(u, "_blank", "noopener,noreferrer");
  } catch {
    window.location.href = u;
  }
}

export function LiveBroadcastCard({
  live,
  viewerFirstName,
  watching,
  onWatch,
}: {
  live: LiveBroadcastActive;
  viewerFirstName: string;
  watching: boolean;
  onWatch: () => void | Promise<void>;
}) {
  const platformLabel =
    live.platform === "kick" ? creatorKickLabel : creatorTwitchLabel;
  const vpnText = live.vpnNote?.trim() || defaultVpnNote;

  return (
    <div className="live-broadcast-card card">
      <div className="live-broadcast-card__top">
        <div className="live-broadcast-card__avatar-wrap">
          {creatorAvatar ? (
            <img
              className="live-broadcast-card__avatar"
              src={creatorAvatar}
              alt=""
            />
          ) : (
            <div className="live-broadcast-card__avatar live-broadcast-card__avatar--placeholder" />
          )}
          <span className="live-broadcast-card__live-badge" aria-hidden>
            <span className="live-broadcast-card__live-dot" /> LIVE
          </span>
        </div>
        <div className="live-broadcast-card__identity">
          <p className="live-broadcast-card__name">{creatorName}</p>
          <p
            className={
              live.platform === "kick"
                ? "live-broadcast-card__platform live-broadcast-card__platform--kick"
                : "live-broadcast-card__platform live-broadcast-card__platform--twitch"
            }
          >
            {platformLabel}
          </p>
        </div>
      </div>

      <blockquote className="live-broadcast-card__quote">
        <p>
          {viewerFirstName}, я сейчас в эфире! Заходи на стрим, общайся в чате и
          выполняй задания — заработай монеты прямо сейчас
        </p>
      </blockquote>

      <p className="live-broadcast-card__vpn">{vpnText}</p>

      <button
        type="button"
        className="primary live-broadcast-card__cta"
        disabled={watching}
        onClick={() => void onWatch()}
      >
        {watching ? "…" : "Смотреть стрим"}
      </button>
    </div>
  );
}

