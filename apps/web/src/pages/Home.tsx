import {
  ChevronDown,
  Coins,
  Flame,
  Gift,
  HelpCircle,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse } from "shared";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";

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
  cashback: {
    enabled: boolean;
    title: string;
    imageUrl: string | null;
    body: string;
  };
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
}: {
  me: MeResponse | null;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const { activePlatform } = useActivePlatform();
  const [claiming, setClaiming] = useState<"twitch" | "kick" | null>(null);
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

  if (!me) {
    return (
      <div className="card">
        <p className="muted">Загрузка профиля…</p>
      </div>
    );
  }

  /** В шапке главной всегда Telegram (имя и аватар из TG). Twitch/Kick — в профиле и стрике. */
  const tgDisplayName =
    me.firstName?.trim() ||
    (me.username ? `@${me.username}` : null) ||
    "Игрок";

  const streakForPlatform =
    activePlatform === "twitch" ? me.streakTwitch : me.streakKick;
  const streakPct = Math.min(100, (streakForPlatform / STREAK_TARGET) * 100);

  async function claimStreamStreak(platform: "twitch" | "kick") {
    setClaiming(platform);
    const r = await api<{
      ok: boolean;
      streak: number;
      platform: string;
    }>("/api/v1/stream-streak/claim", {
      method: "POST",
      body: JSON.stringify({ platform }),
    });
    setClaiming(null);
    if (!r.ok) {
      showToast(formatApiError(r), "error");
      return;
    }
    showToast(
      platform === "twitch"
        ? `Twitch: стрик ${r.data.streak} дн.`
        : `Kick: стрик ${r.data.streak} дн.`,
      "success"
    );
    onRefresh();
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
    onRefresh();
  }

  return (
    <div>
      <div className="home-hero">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              Режим: {activePlatform === "twitch" ? "Twitch" : "Kick"} · уровень{" "}
              {me.level} · ×{me.rewardMultiplier.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {pub && (
        <div className="home-stats home-stats--public" style={{ marginTop: 12 }}>
          <div className="stat-tile">
            <div className="stat-tile__label">
              <Users size={16} strokeWidth={2} aria-hidden />
              Пользователей
            </div>
            <div className="stat-tile__value" style={{ color: "var(--accent)" }}>
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

      <div className="streak-card">
        <div className="streak-card__head">
          <div className="streak-card__flame" aria-hidden>
            <Flame size={24} color="var(--accent)" strokeWidth={2} />
          </div>
          <div>
            <p className="streak-card__title">Начни свой стрик!</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Не пропускай стримы с подписанного канала — бонус за серию дней
              (UTC). Сейчас: {streakForPlatform} / {STREAK_TARGET}.
            </p>
          </div>
        </div>

        <div className="stream-streak-grid">
          {activePlatform === "twitch" ? (
            <div className="stream-streak-row">
              <div>
                <span className="pill pill--twitch">Twitch</span>
                <p className="stream-streak-row__val">
                  {me.streakTwitch} дн. подряд
                </p>
              </div>
              <button
                type="button"
                className="primary stream-streak-row__btn"
                disabled={
                  claiming !== null ||
                  me.platforms.twitch.status === "not_connected"
                }
                onClick={() => void claimStreamStreak("twitch")}
              >
                {claiming === "twitch"
                  ? "…"
                  : me.platforms.twitch.status === "not_connected"
                    ? "Нет Twitch"
                    : "Засчитать"}
              </button>
            </div>
          ) : (
            <div className="stream-streak-row">
              <div>
                <span className="pill pill--kick">Kick</span>
                <p className="stream-streak-row__val">
                  {me.streakKick} дн. подряд
                </p>
              </div>
              <button
                type="button"
                className="primary stream-streak-row__btn"
                disabled={
                  claiming !== null ||
                  me.platforms.kick.status === "not_connected"
                }
                onClick={() => void claimStreamStreak("kick")}
              >
                {claiming === "kick"
                  ? "…"
                  : me.platforms.kick.status === "not_connected"
                    ? "Нет Kick"
                    : "Засчитать"}
              </button>
            </div>
          )}
        </div>

        <div className="streak-card__bar" aria-hidden style={{ marginTop: 12 }}>
          <div
            className="streak-card__fill"
            style={{ width: `${streakPct}%` }}
          />
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
          Стрик на {activePlatform === "twitch" ? "Twitch" : "Kick"}:{" "}
          {streakForPlatform} / {STREAK_TARGET} дней
        </p>
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <Gift size={18} aria-hidden />
          <h2 style={{ margin: 0, fontSize: 16 }}>Промокод</h2>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            className="input-like"
            placeholder="Введите промокод"
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
            style={{ flex: 1, minWidth: 120 }}
          />
          <button type="button" className="primary" onClick={() => void applyPromo()}>
            Применить
          </button>
        </div>
      </div>

      {pub && pub.giveaways.length > 0 && (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Активные розыгрыши</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Все
            </span>
          </div>
          {pub.giveaways.map((g) => (
            <Link
              key={g.id}
              to={`/giveaway/${g.id}`}
              className="card giveaway-card giveaway-card--link"
            >
              {g.imageUrl ? (
                <img src={g.imageUrl} alt="" className="giveaway-card__img" />
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

      {pub && pub.cashback.enabled && (
        <div className="card stack cashback-card" style={{ marginTop: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{pub.cashback.title}</h2>
          {pub.cashback.imageUrl && (
            <img
              src={pub.cashback.imageUrl}
              alt=""
              style={{ width: "100%", borderRadius: 12, maxHeight: 220, objectFit: "cover" }}
            />
          )}
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {pub.cashback.body}
          </p>
        </div>
      )}

      {pub && pub.faq.length > 0 && (
        <section className="faq-section stack" style={{ marginTop: 8 }}>
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
