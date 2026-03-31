import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  ChevronRight,
  Coins,
  Copy,
  Radio,
  Tv,
  Users,
} from "lucide-react";
import type { MeResponse, ReferralsResponse } from "shared";
import WebApp from "@twa-dev/sdk";
import { api, formatApiError, setToken } from "../api";
import { useToast } from "../context/ToastContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { useOAuthLink } from "../hooks/useOAuthLink";

export default function Profile({
  me,
  onRefresh,
  onShowOnboarding,
}: {
  me: MeResponse | null;
  onRefresh: () => void;
  onShowOnboarding?: () => void;
}) {
  const { showToast } = useToast();
  const { startOAuth, connectStub, stub } = useOAuthLink(onRefresh);
  const [refs, setRefs] = useState<ReferralsResponse | null>(null);

  const loadRefs = useCallback(async () => {
    const r = await api<ReferralsResponse>("/api/v1/referrals");
    if (r.ok) setRefs(r.data);
    else if (!r.networkError) showToast(formatApiError(r), "error");
  }, [showToast]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ok = q.get("oauth_ok");
    const err = q.get("oauth_err");
    if (!ok && !err) return;

    window.history.replaceState({}, "", "/profile");

    void (async () => {
      await onRefresh();
      await loadRefs();
      if (ok) {
        showToast(
          ok === "twitch"
            ? "Twitch подключён — стрик и задания для Twitch доступны."
            : "Kick подключён — стрик и задания для Kick доступны.",
          "success",
          { durationMs: 5500 }
        );
        try {
          WebApp.HapticFeedback.notificationOccurred("success");
        } catch {
          /* ignore */
        }
      } else if (err) {
        const decoded = decodeURIComponent(err);
        const hint =
          /redirect_uri|registered\s+URI/i.test(decoded)
            ? " В консоли Twitch/Kick в OAuth Redirect добавьте URL API: http://localhost:3001/api/v1/oauth/…/callback (порт 3001, не 5173)."
            : "";
        showToast(`Не удалось подключить: ${decoded}${hint}`, "error");
        try {
          WebApp.HapticFeedback.notificationOccurred("error");
        } catch {
          /* ignore */
        }
      }
    })();
  }, [onRefresh, loadRefs, showToast]);

  async function disconnect(platform: string) {
    const r = await api(`/api/v1/platforms/${platform}`, { method: "DELETE" });
    if (r.ok) {
      showToast("Отключено", "info");
      onRefresh();
    } else showToast(formatApiError(r), "error");
  }

  async function copyLink() {
    const link = me?.referralLink ?? refs?.referralLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast("Ссылка скопирована", "success");
    } catch {
      showToast("Не удалось скопировать", "error");
    }
  }

  async function deleteAccount() {
    if (!confirm("Удалить аккаунт и все данные?")) return;
    const r = await api("/api/v1/account/delete", { method: "POST" });
    if (r.ok) {
      setToken(null);
      window.location.reload();
    } else showToast(formatApiError(r), "error");
  }

  if (!me) {
    return <PageSkeleton />;
  }

  const displayName = me.firstName ?? "Игрок";
  const handle = me.username ? `@${me.username}` : me.telegramId;

  return (
    <div>
      {onShowOnboarding && (
        <p className="muted profile-link-intro">
          <button
            type="button"
            className="link-like"
            onClick={() => onShowOnboarding()}
          >
            Как подключить Twitch / Kick?
          </button>
        </p>
      )}

      <div className="card card--flush">
        <div className="profile-hero">
          {me.photoUrl ? (
            <img className="avatar avatar-ring" src={me.photoUrl} alt="" />
          ) : (
            <div className="avatar avatar-ring" />
          )}
          <div className="profile-hero__text">
            <h2>{displayName}</h2>
            <p className="muted profile-hero__handle">{handle}</p>
          </div>
        </div>
      </div>

      <div className="card stack card--pad-sm profile-stats-row">
        <div className="profile-stat-cell">
          <p className="muted text-caption">Уровень</p>
          <p className="label-strong">{me.level}</p>
        </div>
        <div className="profile-stat-cell">
          <p className="muted text-caption">Ранг (монеты)</p>
          <p className="label-strong">
            {me.leaderboardRankCoins != null
              ? `#${me.leaderboardRankCoins}`
              : "—"}
          </p>
        </div>
        <div className="profile-stat-cell">
          <p className="muted text-caption">Множитель</p>
          <p className="label-strong">×{me.rewardMultiplier.toFixed(2)}</p>
        </div>
      </div>

      <div className="card stack card--pad-sm">
        <div className="profile-row">
          <div className="profile-row__left">
            <div className="profile-row__icon">
              <Tv size={20} strokeWidth={2} aria-hidden />
            </div>
            <div className="profile-platform-line">
              {me.platforms.twitch.status === "connected" &&
                me.platforms.twitch.avatarUrl && (
                  <img
                    src={me.platforms.twitch.avatarUrl}
                    alt=""
                    width={36}
                    height={36}
                    className="platform-avatar--sm"
                  />
                )}
              <div>
                <div className="label-strong">Twitch</div>
                <div className="muted text-caption">
                  {me.platforms.twitch.status === "connected"
                    ? me.platforms.twitch.displayName ?? "Подключено"
                    : "Не подключено"}
                </div>
              </div>
            </div>
          </div>
          {me.platforms.twitch.status === "not_connected" ? (
            <button
              type="button"
              className="primary"
              onClick={() => void startOAuth("twitch")}
            >
              OAuth
            </button>
          ) : (
            <button type="button" onClick={() => void disconnect("twitch")}>
              Отключить
            </button>
          )}
        </div>

        <div className="profile-row">
          <div className="profile-row__left">
            <div className="profile-row__icon">
              <Radio size={20} strokeWidth={2} aria-hidden />
            </div>
            <div className="profile-platform-line">
              {me.platforms.kick.status === "connected" &&
                me.platforms.kick.avatarUrl && (
                  <img
                    src={me.platforms.kick.avatarUrl}
                    alt=""
                    width={36}
                    height={36}
                    className="platform-avatar--sm"
                  />
                )}
              <div>
                <div className="label-strong">Kick</div>
                <div className="muted text-caption">
                  {me.platforms.kick.status === "connected"
                    ? me.platforms.kick.displayName ?? "Подключено"
                    : "Не подключено"}
                </div>
              </div>
            </div>
          </div>
          {me.platforms.kick.status === "not_connected" ? (
            <button
              type="button"
              className="primary"
              onClick={() => void startOAuth("kick")}
            >
              OAuth
            </button>
          ) : (
            <button type="button" onClick={() => void disconnect("kick")}>
              Отключить
            </button>
          )}
        </div>

        <div className="profile-row">
          <div className="profile-row__left">
            <div className="profile-row__icon">
              <Coins size={20} strokeWidth={2} aria-hidden />
            </div>
            <div>
              <div className="label-strong">Балансы</div>
              <div className="muted text-caption">
                Twitch: {me.coinsTwitch.toLocaleString("ru-RU")} · Kick:{" "}
                {me.coinsKick.toLocaleString("ru-RU")} · всего{" "}
                {me.coins.toLocaleString("ru-RU")}
              </div>
            </div>
          </div>
        </div>

        <div className="profile-row">
          <div className="profile-row__left">
            <div className="profile-row__icon">
              <Users size={20} strokeWidth={2} aria-hidden />
            </div>
            <div>
              <div className="label-strong">Рефералов</div>
              <div className="muted text-caption">
                {refs?.totalInvited ?? me.referralCount} (квалиф.{" "}
                {refs?.qualifiedCount ?? 0})
              </div>
            </div>
          </div>
          <ChevronRight size={20} className="muted" aria-hidden />
        </div>

        <div className="profile-row">
          <div className="profile-row__left">
            <div className="profile-row__icon">
              <Calendar size={20} strokeWidth={2} aria-hidden />
            </div>
            <div>
              <div className="label-strong">Код</div>
              <div className="muted text-caption">
                {me.referralCode}
              </div>
            </div>
          </div>
        </div>

        {stub && (
          <p className="muted">
            Dev stub:{" "}
            <button type="button" onClick={() => void connectStub("twitch")}>
              Twitch stub
            </button>{" "}
            <button type="button" onClick={() => void connectStub("kick")}>
              Kick stub
            </button>
          </p>
        )}
        <p className="muted profile-hint">
          <strong>Redirect в консоли Twitch/Kick</strong> — это всегда{" "}
          <code>…/api/v1/oauth/…/callback</code> на <strong>сервере API</strong> (локально порт{" "}
          <strong>3001</strong>), не страница на 5173. Примеры:{" "}
          <code>http://localhost:3001/api/v1/oauth/twitch/callback</code>,{" "}
          <code>http://localhost:3001/api/v1/oauth/kick/callback</code>. На проде —{" "}
          <code>https://ваш-домен/api/v1/oauth/twitch/callback</code>.{" "}
          <code>PUBLIC_WEB_URL</code> в API — URL фронта (куда вернуть пользователя после успеха:{" "}
          <code>/oauth/…</code>).
        </p>
      </div>

      <div className="card stack">
        <h2 className="profile-section-title">Реферальная ссылка</h2>
        <p className="muted m-0 text-body">
          За каждого приглашённого — бонус по правилам бота.
        </p>
        <div className="warning-box">
          У реферала должен быть публичный @username в Telegram, если это
          требуется для квалификации.
        </div>
        <div className="referral-field">
          <input readOnly value={me.referralLink ?? refs?.referralLink ?? ""} />
          <button type="button" onClick={() => void copyLink()} aria-label="Копировать">
            <Copy size={20} aria-hidden />
          </button>
        </div>
        <div className="stack referral-list-stack">
          {refs?.invited.map((i) => (
            <div key={i.refereeId} className="row leader-row">
              <span>{i.displayName}</span>
              <span className="pill">{i.qualified ? "ок" : "ждёт"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h2>Опасная зона</h2>
        <button type="button" onClick={() => void deleteAccount()}>
          Удалить аккаунт
        </button>
      </div>
    </div>
  );
}
