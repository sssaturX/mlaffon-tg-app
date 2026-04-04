import {
  ChevronDown,
  Coins,
  Flame,
  Gift,
  HelpCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import WebApp from "@twa-dev/sdk";
import { Link } from "react-router-dom";
import type { MeEconomyPatch, MeResponse } from "shared";
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
import { useDocumentVisible } from "../hooks/useDocumentVisible";
import {
  useLiveBroadcastStore,
  type LiveBroadcastPublic,
} from "../store/liveBroadcastStore";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { usePredictionStore } from "../store/predictionStore";

const STREAK_TARGET = 7;

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

function formatLiveCountdown(iso: string, nowMs: number): string {
  const end = new Date(iso).getTime();
  const left = Math.max(0, end - nowMs);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AnimatedInt({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState(false);
  const prevRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;
    const dur = 260;
    const start = performance.now();
    setBump(false);
    requestAnimationFrame(() => setBump(true));
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + (to - from) * eased);
      setShown(next);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return (
    <span className={bump ? "prediction-num prediction-num--bump" : "prediction-num"}>
      {shown.toLocaleString("ru-RU")}
    </span>
  );
}

export default function Home({
  me,
  realtimeWsConnected,
}: {
  me: MeResponse | null;
  /** Стабильное WS — реже опрашиваем GET /live-broadcast. */
  realtimeWsConnected: boolean;
}) {
  const { patchMe, patchEconomy, refreshMe } = useMeEconomySync();
  const { showToast } = useToast();
  const { activePlatform, setActivePlatform } = useActivePlatform();
  const [watchingLive, setWatchingLive] = useState(false);
  const live = useLiveBroadcastStore((s) => s.broadcast);
  /** Локальный стрик сразу после watch — не зависит от задержки /me в WebView. */
  const [streakDisplay, setStreakDisplay] = useState<{
    platform: "twitch" | "kick";
    value: number;
  } | null>(null);
  const liveActivePrevRef = useRef<boolean | null>(null);
  const docVisible = useDocumentVisible();
  const tabWasHiddenRef = useRef(false);
  const [pub, setPub] = useState<HomePublic | null>(null);
  const [promo, setPromo] = useState("");
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const prediction = usePredictionStore((s) => s.prediction);
  const hydratePrediction = usePredictionStore((s) => s.hydrateFromApi);
  const [predictionOpen, setPredictionOpen] = useState(false);
  const [predictionOption, setPredictionOption] = useState<"A" | "B">("A");
  const [predictionAmount, setPredictionAmount] = useState("");
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionCooldown, setPredictionCooldown] = useState(false);
  const [predictionSuccess, setPredictionSuccess] = useState(false);
  const predictionCooldownTimerRef = useRef<number | null>(null);
  const predictionSuccessTimerRef = useRef<number | null>(null);
  const [predictionToastCompact, setPredictionToastCompact] = useState(false);
  const [predictionNowMs, setPredictionNowMs] = useState(() => Date.now());

  const loadPublic = useCallback(async () => {
    const r = await api<HomePublic>("/api/v1/home/public");
    if (r.ok) setPub(r.data);
  }, []);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    void hydratePrediction();
  }, [hydratePrediction]);

  useEffect(() => {
    return () => {
      if (predictionCooldownTimerRef.current != null) {
        window.clearTimeout(predictionCooldownTimerRef.current);
      }
      if (predictionSuccessTimerRef.current != null) {
        window.clearTimeout(predictionSuccessTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!prediction || prediction.status !== "active") return;
    setPredictionToastCompact(false);
    const id = window.setTimeout(() => setPredictionToastCompact(true), 6500);
    return () => window.clearTimeout(id);
  }, [prediction?.id, prediction?.status]);

  useEffect(() => {
    if (!prediction || prediction.status !== "active") return;
    const id = window.setInterval(() => setPredictionNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [prediction?.id, prediction?.status]);

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
      await refreshMe();
    })();
  }, [showToast, refreshMe]);

  const hydrateLive = useCallback(() => {
    void useLiveBroadcastStore.getState().hydrateFromApi();
  }, []);

  /** Шапка и стрик совпадают с платформой эфира. */
  useEffect(() => {
    if (live?.active) {
      setActivePlatform(live.platform);
    }
  }, [live, setActivePlatform]);

  /** Синхронизация сразу после возврата во вкладку (без ожидания интервала). */
  useEffect(() => {
    if (!docVisible) {
      tabWasHiddenRef.current = true;
      return;
    }
    if (tabWasHiddenRef.current) {
      tabWasHiddenRef.current = false;
      void hydrateLive();
    }
  }, [docVisible, hydrateLive]);

  useEffect(() => {
    if (!docVisible) return;
    if (realtimeWsConnected) return;
    const ms = live?.active ? 30_000 : 60_000;
    const id = window.setInterval(() => void hydrateLive(), ms);
    return () => clearInterval(id);
  }, [hydrateLive, docVisible, live?.active, realtimeWsConnected]);

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
        economy: MeEconomyPatch;
      }>("/api/v1/live-broadcast/watch", {
        method: "POST",
        body: JSON.stringify({ broadcastId: live.id }),
      });
      if (!r.ok) {
        notifyStreakWatchError(showToast, formatApiError(r));
        return;
      }
      patchEconomy(r.data.economy);
      if (!r.data.alreadyWatchedThisBroadcast) {
        flushSync(() => {
          setStreakDisplay({
            platform: live.platform,
            value: r.data.streak,
          });
        });
      }
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
    const r = await api<{
      ok: boolean;
      reward: number;
      economy: MeEconomyPatch;
    }>("/api/v1/promo/apply", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (!r.ok) {
      showToast(formatApiError(r), "error");
      return;
    }
    patchEconomy(r.data.economy);
    showToast(`+${r.data.reward} монет`, "success");
    setPromo("");
  }

  async function submitPrediction() {
    if (!prediction || predictionCooldown) return;
    const amount = Math.floor(Number(predictionAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Введите сумму ставки больше нуля", "error");
      return;
    }
    setPredictionCooldown(true);
    if (predictionCooldownTimerRef.current != null) {
      window.clearTimeout(predictionCooldownTimerRef.current);
    }
    predictionCooldownTimerRef.current = window.setTimeout(() => {
      setPredictionCooldown(false);
      predictionCooldownTimerRef.current = null;
    }, 1500);
    setPredictionLoading(true);
    const r = await api<{ ok: boolean }>("/api/v1/predictions/" + prediction.id + "/bet", {
      method: "POST",
      body: JSON.stringify({ option: predictionOption, amount }),
    });
    setPredictionLoading(false);
    if (!r.ok) {
      showToast(formatApiError(r), "error");
      return;
    }
    showToast("Ставка принята", "success");
    setPredictionSuccess(true);
    if (predictionSuccessTimerRef.current != null) {
      window.clearTimeout(predictionSuccessTimerRef.current);
    }
    predictionSuccessTimerRef.current = window.setTimeout(() => {
      setPredictionSuccess(false);
      predictionSuccessTimerRef.current = null;
    }, 1200);
    setPredictionOpen(false);
    setPredictionAmount("");
    await hydratePrediction();
  }

  return (
    <div>
      {prediction && prediction.status === "active" ? (
        <button
          type="button"
          className={
            predictionToastCompact
              ? "prediction-toast prediction-toast--compact"
              : "prediction-toast"
          }
          onClick={() => setPredictionOpen(true)}
        >
          <div className="prediction-live">
            <span className="prediction-live__dot" />
            <span>LIVE</span>
          </div>
          <div className="prediction-toast__text">
            <strong>{predictionToastCompact ? "Prediction LIVE" : "Prediction started"}</strong>
            {!predictionToastCompact ? (
              <span>
                {prediction.title}
                {prediction.autoCloseAt
                  ? ` · ${formatLiveCountdown(prediction.autoCloseAt, predictionNowMs)}`
                  : ""}
              </span>
            ) : null}
          </div>
        </button>
      ) : null}

      {predictionOpen && prediction ? (
        <div className="prediction-modal__backdrop" onClick={() => setPredictionOpen(false)}>
          <div
            className="prediction-modal__card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="prediction-modal__head">
              <div className="prediction-modal__head-top">
                <h3>{prediction.title}</h3>
                <div className="prediction-live">
                  <span className="prediction-live__dot" />
                  <span>LIVE</span>
                </div>
              </div>
              <div className="prediction-modal__head-meta">
                <span className="prediction-using-badge">
                  Using: {prediction.platform.name}
                </span>
                {prediction.autoCloseAt ? (
                  <span className="muted">
                    Закрытие через {formatLiveCountdown(prediction.autoCloseAt, predictionNowMs)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="prediction-modal__options">
              <button
                type="button"
                className={predictionOption === "A" ? "prediction-opt prediction-opt--active" : "prediction-opt"}
                onClick={() => setPredictionOption("A")}
              >
                <strong>{prediction.optionA}</strong>
                <div className="prediction-opt__meta">
                  <span><AnimatedInt value={prediction.optionAPool} /> очков</span>
                  <span><AnimatedInt value={prediction.participantsA} /> участников</span>
                </div>
                <span className="prediction-opt__odds">
                  x{prediction.coefficientA != null ? prediction.coefficientA.toFixed(2) : "—"}
                </span>
              </button>
              <button
                type="button"
                className={predictionOption === "B" ? "prediction-opt prediction-opt--active" : "prediction-opt"}
                onClick={() => setPredictionOption("B")}
              >
                <strong>{prediction.optionB}</strong>
                <div className="prediction-opt__meta">
                  <span><AnimatedInt value={prediction.optionBPool} /> очков</span>
                  <span><AnimatedInt value={prediction.participantsB} /> участников</span>
                </div>
                <span className="prediction-opt__odds">
                  x{prediction.coefficientB != null ? prediction.coefficientB.toFixed(2) : "—"}
                </span>
              </button>
            </div>
            <div className="prediction-modal__form">
              <label htmlFor="predictionAmount">Сумма</label>
              <input
                className="prediction-modal__amount"
                id="predictionAmount"
                type="number"
                min={1}
                value={predictionAmount}
                onChange={(e) => setPredictionAmount(e.target.value)}
                placeholder="100"
              />
              <div className="prediction-quick">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setPredictionAmount((v) =>
                      String((Number.parseInt(v || "0", 10) || 0) + 100)
                    )
                  }
                >
                  +100
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setPredictionAmount((v) =>
                      String((Number.parseInt(v || "0", 10) || 0) + 500)
                    )
                  }
                >
                  +500
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setPredictionAmount(String(Math.max(0, prediction.myPlatformBalance ?? 0)))
                  }
                >
                  MAX
                </button>
              </div>
              <p className="muted">
                Баланс:{" "}
                {prediction.myPlatformBalance != null
                  ? <AnimatedInt value={prediction.myPlatformBalance} />
                  : "—"}
              </p>
              <button
                type="button"
                className="primary prediction-modal__cta"
                disabled={
                  predictionLoading ||
                  predictionCooldown ||
                  prediction.myBet != null ||
                  !Number.isFinite(Number(predictionAmount)) ||
                  Number(predictionAmount) <= 0
                }
                onClick={() => void submitPrediction()}
              >
                {prediction.myBet
                  ? "Ставка уже сделана"
                  : predictionSuccess
                    ? "Placed"
                    : predictionLoading || predictionCooldown
                    ? "..."
                    : "Place Prediction"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
