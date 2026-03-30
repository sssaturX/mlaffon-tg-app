import { Coins, Flame, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { MeResponse } from "shared";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";

const STREAK_TARGET = 7;

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
  const platformCoins =
    activePlatform === "twitch" ? me.coinsTwitch : me.coinsKick;
  const platformLifetime =
    activePlatform === "twitch" ? me.lifetimeTwitch : me.lifetimeKick;
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
              Режим: {activePlatform === "twitch" ? "Twitch" : "Kick"} · уровень{" "}
              {me.level} · ×{me.rewardMultiplier.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <div className="home-stats">
        <div className="stat-tile">
          <div className="stat-tile__label">
            <Coins size={16} strokeWidth={2} aria-hidden />
              Монеты ({activePlatform === "twitch" ? "Twitch" : "Kick"})
          </div>
          <div className="stat-tile__value" style={{ color: "var(--accent)" }}>
            {platformCoins.toLocaleString("ru-RU")}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">
            <TrendingUp size={16} strokeWidth={2} aria-hidden />
            Заработано на платформе
          </div>
          <div className="stat-tile__value">
            {platformLifetime.toLocaleString("ru-RU")}
          </div>
        </div>
      </div>

      <div className="streak-card">
        <div className="streak-card__head">
          <Flame size={22} color="var(--accent)" aria-hidden />
          <div>
            <p className="streak-card__title">Стрик на стриме</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Для выбранной в шапке платформы (UTC). Засчитывается, когда стрим в
              эфире и вы подписаны на канал.
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

      <button type="button" className="primary" onClick={() => onRefresh()}>
        Обновить данные
      </button>
    </div>
  );
}
