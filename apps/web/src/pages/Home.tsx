import { Coins, Flame, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { MeResponse } from "shared";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";

const STREAK_TARGET = 7;

export default function Home({
  me,
  onRefresh,
}: {
  me: MeResponse | null;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [claiming, setClaiming] = useState<"twitch" | "kick" | null>(null);

  if (!me) {
    return (
      <div className="card">
        <p className="muted">Загрузка профиля…</p>
        <button type="button" className="primary" onClick={() => onRefresh()}>
          Обновить
        </button>
      </div>
    );
  }

  const displayName =
    me.firstName ?? (me.username ? `@${me.username}` : "Игрок");
  const maxStreak = Math.max(me.streakTwitch, me.streakKick);
  const streakPct = Math.min(100, (maxStreak / STREAK_TARGET) * 100);

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
            <p className="home-hero__name">{displayName}</p>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              Уровень {me.level} · множитель ×{me.rewardMultiplier.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <div className="home-stats">
        <div className="stat-tile">
          <div className="stat-tile__label">
            <Coins size={16} strokeWidth={2} aria-hidden />
            Монеты
          </div>
          <div className="stat-tile__value" style={{ color: "var(--accent)" }}>
            {me.coins.toLocaleString("ru-RU")}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">
            <TrendingUp size={16} strokeWidth={2} aria-hidden />
            Всего заработано
          </div>
          <div className="stat-tile__value">
            {me.lifetimeEarned.toLocaleString("ru-RU")}
          </div>
        </div>
      </div>

      <div className="streak-card">
        <div className="streak-card__head">
          <Flame size={22} color="var(--accent)" aria-hidden />
          <div>
            <p className="streak-card__title">Стрик на стриме</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Отдельно по Twitch и Kick (UTC). Засчитывается, когда стрим в
              эфире и вы подписаны на канал.
            </p>
          </div>
        </div>

        <div className="stream-streak-grid">
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
                claiming !== null || me.platforms.twitch === "not_connected"
              }
              onClick={() => void claimStreamStreak("twitch")}
            >
              {claiming === "twitch"
                ? "…"
                : me.platforms.twitch === "not_connected"
                  ? "Нет Twitch"
                  : "Засчитать"}
            </button>
          </div>
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
                claiming !== null || me.platforms.kick === "not_connected"
              }
              onClick={() => void claimStreamStreak("kick")}
            >
              {claiming === "kick"
                ? "…"
                : me.platforms.kick === "not_connected"
                  ? "Нет Kick"
                  : "Засчитать"}
            </button>
          </div>
        </div>

        <div className="streak-card__bar" aria-hidden style={{ marginTop: 12 }}>
          <div
            className="streak-card__fill"
            style={{ width: `${streakPct}%` }}
          />
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
          Лучший стрик: {maxStreak} / {STREAK_TARGET} дней
        </p>
      </div>

      <button type="button" className="primary" onClick={() => onRefresh()}>
        Обновить данные
      </button>
    </div>
  );
}
