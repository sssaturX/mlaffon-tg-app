import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Calendar,
  ChevronRight,
  Coins,
  Copy,
  Radio,
  Tv,
  Users,
} from "lucide-react";
import type { MeResponse } from "shared";
import WebApp from "@twa-dev/sdk";
import {
  api,
  attachWebCredentials,
  createTelegramLink,
  formatApiError,
  formatOAuthRedirectError,
  getToken,
  setToken,
} from "../api";
import { useToast } from "../context/ToastContext";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { useOAuthLink } from "../hooks/useOAuthLink";
import { PushNotificationsRow } from "../components/PushNotificationsRow";
import {
  useInvalidateReferrals,
  useReferrals,
} from "../hooks/queries/useReferrals";

export default function Profile({
  me,
  onShowOnboarding,
}: {
  me: MeResponse | null;
  onShowOnboarding?: () => void;
}) {
  const { showToast } = useToast();
  const { syncMeFromNetwork } = useMeEconomySync();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const oauthOk = searchParams.get("oauth_ok");
  const oauthErr = searchParams.get("oauth_err");
  const { startOAuth, connectStub, stub } = useOAuthLink();
  const refsQ = useReferrals();
  const invalidateReferrals = useInvalidateReferrals();
  const refs = refsQ.data ?? null;
  const [tgLinkBusy, setTgLinkBusy] = useState(false);
  const [tgLinkUrl, setTgLinkUrl] = useState<string | null>(null);
  const [webEmail, setWebEmail] = useState("");
  const [webPassword, setWebPassword] = useState("");
  const [webPassword2, setWebPassword2] = useState("");
  const [webCredBusy, setWebCredBusy] = useState(false);

  useEffect(() => {
    if (!getToken() || !(oauthOk || oauthErr)) return;
    let cancelled = false;
    void (async () => {
      await syncMeFromNetwork();
      if (cancelled) return;
      invalidateReferrals();
      navigate("/profile", { replace: true });
      if (oauthOk) {
        showToast(
          oauthOk === "twitch"
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
      } else if (oauthErr) {
        const decoded = decodeURIComponent(oauthErr);
        showToast(formatOAuthRedirectError(decoded), "error");
        try {
          WebApp.HapticFeedback.notificationOccurred("error");
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    oauthOk,
    oauthErr,
    syncMeFromNetwork,
    invalidateReferrals,
    navigate,
    showToast,
  ]);

  async function disconnect(platform: string) {
    const r = await api(`/api/v1/platforms/${platform}`, { method: "DELETE" });
    if (r.ok) {
      showToast("Отключено", "info");
      void syncMeFromNetwork();
      invalidateReferrals();
    } else showToast(formatApiError(r), "error");
  }

  async function copyReferral(kind: "mini" | "web") {
    const mini =
      me?.referralLinkMiniApp ?? refs?.referralLinkMiniApp ?? me?.referralLink ?? refs?.referralLink;
    const web = me?.referralLinkWeb ?? refs?.referralLinkWeb;
    const link = kind === "mini" ? mini : web;
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
  const handle = me.username
    ? `@${me.username}`
    : me.telegramId != null
      ? me.telegramId
      : me.email ?? "Игрок";

  async function requestTelegramLink() {
    setTgLinkBusy(true);
    setTgLinkUrl(null);
    try {
      const r = await createTelegramLink();
      if (r.ok) {
        setTgLinkUrl(r.data.botStartUrl);
        showToast("Откройте ссылку в Telegram", "success");
      } else {
        showToast(formatApiError(r), "error");
      }
    } finally {
      setTgLinkBusy(false);
    }
  }

  async function copyTgLink() {
    if (!tgLinkUrl) return;
    try {
      await navigator.clipboard.writeText(tgLinkUrl);
      showToast("Ссылка скопирована — откройте её в Telegram", "success");
    } catch {
      showToast("Не удалось скопировать", "error");
    }
  }

  async function submitWebCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (webPassword !== webPassword2) {
      showToast("Пароли не совпадают", "error");
      return;
    }
    setWebCredBusy(true);
    try {
      const r = await attachWebCredentials(webEmail, webPassword);
      if (r.ok) {
        showToast("Можно входить на сайте по этому email и паролю", "success");
        setWebEmail("");
        setWebPassword("");
        setWebPassword2("");
        void syncMeFromNetwork();
      } else {
        showToast(formatApiError(r), "error");
      }
    } finally {
      setWebCredBusy(false);
    }
  }

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

      {me.telegramId != null && !me.email && (
        <div className="card stack card--pad-sm">
          <h3 className="profile-section-title">Вход на сайте</h3>
          <p className="muted">
            Задайте email и пароль — тот же прогресс будет в браузере без Telegram.
          </p>
          <form className="stack" onSubmit={submitWebCredentials}>
            <label className="stack gap-0">
              <span className="muted text-caption">Email</span>
              <input
                type="email"
                autoComplete="email"
                value={webEmail}
                onChange={(e) => setWebEmail(e.target.value)}
                required
                disabled={webCredBusy}
              />
            </label>
            <label className="stack gap-0">
              <span className="muted text-caption">Пароль (мин. 8 символов)</span>
              <input
                type="password"
                autoComplete="new-password"
                value={webPassword}
                onChange={(e) => setWebPassword(e.target.value)}
                required
                minLength={8}
                disabled={webCredBusy}
              />
            </label>
            <label className="stack gap-0">
              <span className="muted text-caption">Пароль ещё раз</span>
              <input
                type="password"
                autoComplete="new-password"
                value={webPassword2}
                onChange={(e) => setWebPassword2(e.target.value)}
                required
                minLength={8}
                disabled={webCredBusy}
              />
            </label>
            <button type="submit" className="btn primary" disabled={webCredBusy}>
              {webCredBusy ? "…" : "Сохранить"}
            </button>
          </form>
        </div>
      )}

      {me.telegramId == null && me.email && (
        <div className="card stack card--pad-sm">
          <h3 className="profile-section-title">Привязать Telegram</h3>
          <p className="muted">
            Один прогресс на сайте и в мини-приложении: получите ссылку и откройте
            её в Telegram — запустится мини-приложение (startapp), без чата с ботом.
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={tgLinkBusy}
            onClick={() => void requestTelegramLink()}
          >
            {tgLinkBusy ? "…" : "Получить ссылку"}
          </button>
          {tgLinkUrl && (
            <div className="stack gap-2">
              <input readOnly className="mono" value={tgLinkUrl} />
              <button type="button" className="btn" onClick={() => void copyTgLink()}>
                <Copy size={16} aria-hidden /> Скопировать
              </button>
            </div>
          )}
        </div>
      )}

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
              Подключить
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
              Подключить
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

        {import.meta.env.DEV && stub ? (
          <p className="muted">
            Тест:{" "}
            <button type="button" onClick={() => void connectStub("twitch")}>
              Twitch
            </button>{" "}
            <button type="button" onClick={() => void connectStub("kick")}>
              Kick
            </button>
          </p>
        ) : null}
      </div>

      <div className="card stack card--pad-sm">
        <h3 className="profile-section-title">Уведомления о старте эфира</h3>
        <PushNotificationsRow />
      </div>

      <div className="card stack">
        <h2 className="profile-section-title">Реферальные ссылки</h2>
        <p className="muted m-0 text-body">
          Разные ссылки для мини-приложения и для сайта — бонусы по правилам сервиса.
        </p>
        <div className="warning-box">
          У реферала должен быть публичный @username в Telegram, если это
          требуется для квалификации. Регистрации с сайта с одного IP с реф-кодом
          ограничены, чтобы снизить накрутку.
        </div>
        <p className="muted small m-0 text-caption">Мини-приложение (Telegram)</p>
        <div className="referral-field">
          <input
            readOnly
            value={
              me.referralLinkMiniApp ??
              refs?.referralLinkMiniApp ??
              me.referralLink ??
              refs?.referralLink ??
              ""
            }
          />
          <button
            type="button"
            onClick={() => void copyReferral("mini")}
            aria-label="Копировать ссылку для мини-приложения"
          >
            <Copy size={20} aria-hidden />
          </button>
        </div>
        <p className="muted small m-0 text-caption">Сайт (браузер)</p>
        <div className="referral-field">
          <input
            readOnly
            value={me.referralLinkWeb ?? refs?.referralLinkWeb ?? ""}
          />
          <button
            type="button"
            onClick={() => void copyReferral("web")}
            aria-label="Копировать ссылку для сайта"
          >
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
