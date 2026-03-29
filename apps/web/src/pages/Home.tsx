import { Coins, Flame, TrendingUp } from "lucide-react";
import type { MeResponse } from "shared";

const STREAK_TARGET = 7;

export default function Home({
  me,
  onRefresh,
}: {
  me: MeResponse | null;
  onRefresh: () => void;
}) {
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
  const streakPct = Math.min(100, (me.streak / STREAK_TARGET) * 100);

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
            <p className="streak-card__title">Стрик</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {me.streak} дн. подряд — заходите каждый день за бонусами
            </p>
          </div>
        </div>
        <div className="streak-card__bar" aria-hidden>
          <div
            className="streak-card__fill"
            style={{ width: `${streakPct}%` }}
          />
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
          {me.streak} / {STREAK_TARGET} дней
        </p>
      </div>

      <button type="button" className="primary" onClick={() => onRefresh()}>
        Обновить данные
      </button>
    </div>
  );
}
