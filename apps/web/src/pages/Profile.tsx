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
        showToast(`Подключено: ${ok}`, "success");
        try {
          WebApp.HapticFeedback.notificationOccurred("success");
        } catch {
          /* ignore */
        }
      } else if (err) {
        showToast(`Не удалось подключить: ${decodeURIComponent(err)}`, "error");
        try {
          WebApp.HapticFeedback.notificationOccurred("error");
        } catch {
          /* ignore */
        }
      }
    })();
  }, [onRefresh, loadRefs, showToast]);

  async function startOAuth(platform: "twitch" | "kick") {
    const path =
      platform === "twitch"
        ? "/api/v1/oauth/twitch/url"
        : "/api/v1/oauth/kick/url";
    const r = await api<{ url: string }>(path);
    if (!r.ok) {
      showToast(formatApiError(r), "error");
      return;
    }
    const url = r.data.url;
    if (WebApp.initData) {
      WebApp.openLink(url);
    } else {
      window.location.href = url;
    }
  }

  async function connectStub(platform: "twitch" | "kick") {
    const r = await api(`/api/v1/platforms/${platform}/connect`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (r.ok) {
      showToast("Stub-подключение", "success");
      onRefresh();
    } else showToast(formatApiError(r), "error");
  }

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
    return (
      <div className="card">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  const devStub =
    import.meta.env.DEV && import.meta.env.VITE_ALLOW_DEV_STUB === "1";

  const displayName = me.firstName ?? "Игрок";
  const handle = me.username ? `@${me.username}` : me.telegramId;

  return (
    <div>
      {onShowOnboarding && (
        <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
          <button
            type="button"
            className="link-like"
            onClick={() => onShowOnboarding()}
          >
            Как подключить Twitch / Kick?
          </button>
        </p>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="profile-hero">
          {me.photoUrl ? (
            <img className="avatar avatar-ring" src={me.photoUrl} alt="" />
          ) : (
            <div className="avatar avatar-ring" />
          )}
          <div className="profile-hero__text">
            <h2>{displayName}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {handle}
            </p>
          </div>
        </div>
      </div>

      <div className="card stack" style={{ padding: "8px 16px 16px" }}>
        <div className="profile-row">
          <div className="profile-row__left">
            <div className="profile-row__icon">
              <Tv size={20} strokeWidth={2} aria-hidden />
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>Twitch</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {me.platforms.twitch === "connected"
                  ? "Подключено"
                  : "Не подключено"}
              </div>
            </div>
          </div>
          {me.platforms.twitch === "not_connected" ? (
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
            <div>
              <div style={{ fontWeight: 600 }}>Kick</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {me.platforms.kick === "connected"
                  ? "Подключено"
                  : "Не подключено"}
              </div>
            </div>
          </div>
          {me.platforms.kick === "not_connected" ? (
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
              <div style={{ fontWeight: 600 }}>Баланс</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {me.coins.toLocaleString("ru-RU")} монет
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
              <div style={{ fontWeight: 600 }}>Рефералов</div>
              <div className="muted" style={{ fontSize: 12 }}>
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
              <div style={{ fontWeight: 600 }}>Код</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {me.referralCode}
              </div>
            </div>
          </div>
        </div>

        {devStub && (
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
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Redirect URI в Twitch/Kick и <code>PUBLIC_WEB_URL</code> на API должны
          совпадать.
        </p>
      </div>

      <div className="card stack">
        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--accent)", marginBottom: 8 }}>
          Реферальная ссылка
        </h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
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
        <div className="stack" style={{ marginTop: 8 }}>
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
