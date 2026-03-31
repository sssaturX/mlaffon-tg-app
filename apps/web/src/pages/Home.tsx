import {
  ChevronDown,
  Coins,
  Flame,
  Gift,
  HelpCircle,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom/client";
import WebApp from "@twa-dev/sdk";
import { Link } from "react-router-dom";
import type { MeResponse } from "shared";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  LiveBroadcastCard,
  openExternal,
  type LiveBroadcastActive,
} from "../components/LiveBroadcastCard";
import { OAUTH_TOAST_KEY } from "./OAuthReturn";
import {
  notifyStreakAlreadyWatchedThisBroadcast,
  notifyStreakWatchError,
  notifyStreakWatchSuccess,
} from "../utils/streakNotifications";

const STREAK_TARGET = 7;

type LiveBroadcastPublic =
  | { active: false }
  | LiveBroadcastActive;

type HomePublic = {
  stats: { usersCount: number; coinsEarnedTotal: number };
  giveaways: {
    id: string;
    title: string;
    prizeText: string;
    description: string | null;
    imageUrl: string | null;
    endsAt: string;
    winnerCount: number;
    ticketPriceCoins: number;
    participantCount: number;
    drawnAt: string | null;
  }[];
  faq: { q: string; a: string }[];
};

function formatCountdown(iso: string): string {
  const end = new Date(iso).getTime();
  const now = Date.now();
  const ms = Math.max(0, end - now);
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  const h = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${d} дн. ${h} ч.`;
}

export default function Home({
  me,
  onRefresh,
  patchMe,
}: {
  me: MeResponse | null;
  onRefresh: () => Promise<MeResponse | null>;
  patchMe: (u: (prev: MeResponse) => Partial<MeResponse>) => void;
}) {
  const { showToast } = useToast();
  const { activePlatform, setActivePlatform } = useActivePlatform();
  const [watchingLive, setWatchingLive] = useState(false);
  const [live, setLive] = useState<LiveBroadcastPublic | null>(null);
  const liveActivePrevRef = useRef<boolean | null>(null);
  const [pub, setPub] = useState<HomePublic | null>(null);
  const [promo, setPromo] = useState("");
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  const loadPublic = useCallback(async () => {
    const r = await api<HomePublic>("/api/v1/home/public");
    if (r.ok) setPub(r.data);
  }, []);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    let k: string | null = null;
    try {
      k = sessionStorage.getItem(OAUTH_TOAST_KEY);
    } catch {
      return;
    }
    if (!k) return;
    try {
      sessionStorage.removeItem(OAUTH_TOAST_KEY);
    } catch {
      /* ignore */
    }
    showToast(
      k === "twitch" ? "Twitch подключён — можно пользоваться стриком на Twitch." : "Kick подключён — можно пользоваться стриком на Kick.",
      "success",
      { durationMs: 5500 }
    );
    try {
      WebApp.HapticFeedback.notificationOccurred("success");
    } catch {
      /* ignore */
    }
    void (async () => {
      await onRefresh();
    })();
  }, [showToast, onRefresh]);

  const loadLive = useCallback(async () => {
    const r = await api<LiveBroadcastPublic>("/api/v1/live-broadcast");
    if (!r.ok) return;
    setLive(r.data);
    /** Шапка и стрик совпадают с платформой эфира (иначе «0 дн» на Twitch при эфире Kick). */
    if (r.data.active) {
      setActivePlatform(r.data.platform);
    }
  }, [setActivePlatform]);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  /** Чаще опрос + при возврате в мини-апп — иначе «Смотреть стрим» появляется только после перезапуска. */
  useEffect(() => {
    const id = window.setInterval(() => void loadLive(), 5000);
    const onForeground = () => void loadLive();
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    window.addEventListener("pageshow", onForeground);
    const tg = WebApp as unknown as {
      onEvent?: (ev: string, cb: () => void) => void;
    };
    tg.onEvent?.("viewport_changed", onForeground);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("pageshow", onForeground);
    };
  }, [loadLive]);

  useEffect(() => {
    if (!live) return;
    const now = live.active;
    const prev = liveActivePrevRef.current;
    if (prev === false && now === true) {
      showToast(
        "Эфир начался — зайдите в приложение и нажмите «Смотреть стрим», чтобы засчитать стрик на Twitch/Kick.",
        "info",
        { durationMs: 7000 }
      );
      try {
        WebApp.HapticFeedback.notificationOccurred("success");
      } catch {
        /* ignore */
      }
    }
    liveActivePrevRef.current = now;
  }, [live, showToast]);

  useEffect(() => {
    if (!streakDisplay || !me) return;
    const v =
      streakDisplay.platform === "twitch" ? me.streakTwitch : me.streakKick;
    if (v === streakDisplay.value) {
      setStreakDisplay(null);
    }
  }, [me, streakDisplay]);

  if (!me) {
    return <PageSkeleton />;
  }

  /** В шапке главной всегда Telegram (имя и аватар из TG). Twitch/Kick — в профиле и стрике. */
  const tgDisplayName =
    me.firstName?.trim() ||
    (me.username ? `@${me.username}` : null) ||
    "Игрок";

  /** Пока идёт эфир — стрик и UI по платформе эфира; иначе по переключателю в шапке. */
  const streakPlatform: "twitch" | "kick" = live?.active
    ? live.platform
    : activePlatform;
  const streakForPlatform =
    streakDisplay && streakDisplay.platform === streakPlatform
      ? streakDisplay.value
      : streakPlatform === "twitch"
        ? me.streakTwitch
        : me.streakKick;
  const streakPct = Math.min(100, (streakForPlatform / STREAK_TARGET) * 100);

  const viewerFirstName = me.firstName?.trim() || "Друг";

  async function watchLive() {
    if (!live?.active) return;
    const url = live.streamUrl.trim();
    if (!url) {
      showToast("Нет ссылки на стрим", "error");
      return;
    }
    const platRu = live.platform === "kick" ? "Kick" : "Twitch";
    /** Сразу открываем ссылку (до любого await), иначе Telegram блокирует openLink. */
    openExternal(url);
    setWatchingLive(true);
    try {
      const r = await api<{
        ok: boolean;
        streak: number;
        streakIncremented: boolean;
        alreadyWatchedThisBroadcast: boolean;
        bonusCoinsAwarded: number;
      }>("/api/v1/live-broadcast/watch", {
        method: "POST",
        body: JSON.stringify({ broadcastId: live.id }),
      });
      if (!r.ok) {
        notifyStreakWatchError(showToast, formatApiError(r));
        return;
      }
      if (!r.data.alreadyWatchedThisBroadcast) {
        flushSync(() => {
          setStreakDisplay({
            platform: live.platform,
            value: r.data.streak,
          });
        });
      }
      await onRefresh();
      if (!r.data.alreadyWatchedThisBroadcast) {
        const st = r.data.streak;
        const p = live.platform;
        patchMe((prev) => {
          const streakTwitch = p === "twitch" ? st : prev.streakTwitch;
          const streakKick = p === "kick" ? st : prev.streakKick;
          return {
            streakTwitch,
            streakKick,
            streak: Math.max(streakTwitch, streakKick),
          };
        });
      }
      setActivePlatform(live.platform);
      if (r.data.alreadyWatchedThisBroadcast) {
        notifyStreakAlreadyWatchedThisBroadcast(
          showToast,
          platRu,
          r.data.streak
        );
      } else {
        notifyStreakWatchSuccess(
          showToast,
          platRu,
          r.data.streak,
          r.data.bonusCoinsAwarded
        );
      }
    } finally {
      setWatchingLive(false);
    }
  }

  async function applyPromo() {
    const code = promo.trim();
    if (!code) return;
    const r = await api<{ ok: boolean; reward: number }>(
      "/api/v1/promo/apply",
      { method: "POST", body: JSON.stringify({ code }) }
    );
    if (!r.ok) {
      showToast(formatApiError(r), "error");
      return;
    }
    showToast(`+${r.data.reward} монет`, "success");
    setPromo("");
    await onRefresh();
  }

  return (
    <div>
      <div className="home-hero">
        <div className="home-hero__row">
          {me.photoUrl ? (
            <img
              className="avatar avatar-ring"
              src={me.photoUrl}
              alt=""
            />
          ) : (
            <div className="avatar avatar-ring" />
          )}
          <div>
            <p className="home-hero__greet">Добро пожаловать,</p>
            <p className="home-hero__name">{tgDisplayName}</p>
            <p className="muted home-hero__sub">
              Режим: {activePlatform === "twitch" ? "Twitch" : "Kick"} · уровень{" "}
              {me.level} · ×{me.rewardMultiplier.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {pub && (
        <div className="home-stats home-stats--public">
          <div className="stat-tile">
            <div className="stat-tile__label">
              <Users size={16} strokeWidth={2} aria-hidden />
              Пользователей
            </div>
            <div className="stat-tile__value stat-tile__value--accent">
              {pub.stats.usersCount.toLocaleString("ru-RU")}
            </div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile__label">
              <Coins size={16} strokeWidth={2} aria-hidden />
              Монет заработано
            </div>
            <div className="stat-tile__value">
              {pub.stats.coinsEarnedTotal.toLocaleString("ru-RU")}
            </div>
          </div>
        </div>
      )}

      {live?.active ? (
        <LiveBroadcastCard
          live={live}
          viewerFirstName={viewerFirstName}
          watching={watchingLive}
          onWatch={watchLive}
        />
      ) : null}

      <div className="streak-card">
        <div className="streak-card__head">
          <div className="streak-card__flame" aria-hidden>
            <Flame size={24} color="var(--accent)" strokeWidth={2} />
          </div>
          <div>
            <p className="streak-card__title">Начни свой стрик!</p>
            <p className="muted streak-card__text">
              {live?.active ? (
                <>
                  Эфир на {streakPlatform === "kick" ? "Kick" : "Twitch"}. Каждый
                  новый эфир в админке — отдельный засчёт: нажми «Смотреть стрим» (один
                  раз на эфир). В один день можно несколько раз подряд. Сейчас:{" "}
                  {streakForPlatform} / {STREAK_TARGET}.
                </>
              ) : (
                <>
                  Выбери платформу в шапке — ниже стрик для неё. Сейчас:{" "}
                  {streakForPlatform} / {STREAK_TARGET}.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="stream-streak-grid stream-streak-grid--readonly">
          <div className="stream-streak-row">
            <div>
              {streakPlatform === "twitch" ? (
                <span className="pill pill--twitch">Twitch</span>
              ) : (
                <span className="pill pill--kick">Kick</span>
              )}
              <p className="stream-streak-row__val">
                {streakForPlatform} подряд
              </p>
            </div>
          </div>
        </div>

        <div className="streak-card__bar streak-card__bar--spaced" aria-hidden>
          <div
            key={`${streakPlatform}-${streakForPlatform}`}
            className="streak-card__fill"
            style={{ width: `${streakPct}%` }}
          />
        </div>
        <p className="muted streak-card__hint">
          Стрик {streakPlatform === "kick" ? "Kick" : "Twitch"}: {streakForPlatform} /{" "}
          {STREAK_TARGET}
        </p>
      </div>

      <div className="card stack home-promo-card">
        <div className="home-promo-card__head">
          <Gift size={18} aria-hidden />
          <h2>Промокод</h2>
        </div>
        <div className="row promo-row--home">
          <input
            className="input-like promo-input-grow"
            placeholder="Введите промокод"
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
          />
          <button type="button" className="primary" onClick={() => void applyPromo()}>
            Применить
          </button>
        </div>
      </div>

      {pub && pub.giveaways.length > 0 && (
        <div className="stack section-stack-top">
          <div className="row section-head">
            <h2>Активные розыгрыши</h2>
            <Link to="/giveaways" className="muted home-giveaways-all">
              Все
            </Link>
          </div>
          {pub.giveaways.map((g) => (
            <Link
              key={g.id}
              to={`/giveaway/${g.id}`}
              className="card giveaway-card giveaway-card--link"
            >
              {g.imageUrl ? (
                <img
                  src={g.imageUrl}
                  alt=""
                  className="giveaway-card__img"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="giveaway-card__placeholder" aria-hidden />
              )}
              <div className="giveaway-card__body">
                <p className="giveaway-card__prize">{g.prizeText}</p>
                <p className="giveaway-card__title">{g.title}</p>
                <p className="giveaway-card__meta muted">
                  {g.participantCount.toLocaleString("ru-RU")} уч. ·{" "}
                  {g.winnerCount} победител{g.winnerCount === 1 ? "ь" : g.winnerCount < 5 ? "я" : "ей"}
                  {g.ticketPriceCoins > 0
                    ? ` · билет ${g.ticketPriceCoins} мон.`
                    : " · бесплатно"}
                </p>
                <div className="giveaway-card__timer">
                  {formatCountdown(g.endsAt)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {pub && pub.faq.length > 0 && (
        <section className="faq-section stack faq-section--top">
          <div className="faq-section__head">
            <div className="faq-section__icon-wrap" aria-hidden>
              <HelpCircle size={22} strokeWidth={2} />
            </div>
            <div>
              <h2 className="faq-section__title">Вопросы и ответы</h2>
              <p className="faq-section__sub muted">Нажми на вопрос, чтобы раскрыть</p>
            </div>
          </div>
          <div className="faq-list">
            {pub.faq.map((item, i) => {
              const open = faqOpen === i;
              return (
                <div
                  key={i}
                  className={`faq-item ${open ? "faq-item--open" : ""}`}
                >
                  <button
                    type="button"
                    className="faq-item__q"
                    onClick={() => setFaqOpen(open ? null : i)}
                    aria-expanded={open}
                  >
                    <span className="faq-item__q-text">{item.q}</span>
                    <ChevronDown
                      size={20}
                      className="faq-item__chev"
                      aria-hidden
                    />
                  </button>
                  <div className="faq-item__a-wrap">
                    <div className="faq-item__a-inner">
                      <p className="faq-item__a">{item.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
