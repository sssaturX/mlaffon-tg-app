/**
 * Таблица рангов 1–40 по суммарному lifetime (Twitch + Kick), из ТЗ заказчика.
 */

/** Минимальный lifetime для ранга с номером index+1 (ранг 1 → 0). */
export const RANK_MIN_LIFETIME: readonly number[] = [
  0, 300, 800, 1500, 2500, 4000, 6000, 8500, 11500, 15000, 19_000, 24_000, 30_000,
  37_000, 45_000, 55_000, 67_000, 82_000, 100_000, 120_000, 145_000, 175_000,
  210_000, 250_000, 300_000, 360_000, 430_000, 510_000, 600_000, 700_000,
  820_000, 950_000, 1_100_000, 1_300_000, 1_550_000, 1_850_000, 2_200_000,
  2_600_000, 3_100_000, 3_700_000,
] as const;

const MAX_RANK = RANK_MIN_LIFETIME.length;

/** Награда монетами при достижении ранга r (r = 2..40). */
export const RANK_STEP_COINS: Readonly<Record<number, number>> = {
  2: 100,
  3: 150,
  4: 200,
  5: 300,
  6: 400,
  7: 500,
  8: 600,
  9: 700,
  10: 1000,
  11: 1200,
  12: 1500,
  13: 1800,
  14: 2200,
  15: 2600,
  16: 3200,
  17: 4000,
  18: 5000,
  19: 6500,
  20: 8000,
  21: 10_000,
  22: 12_000,
  23: 14_000,
  24: 17_000,
  25: 20_000,
  26: 24_000,
  27: 28_000,
  28: 33_000,
  29: 38_000,
  30: 45_000,
  31: 55_000,
  32: 65_000,
  33: 75_000,
  34: 90_000,
  35: 110_000,
  36: 130_000,
  37: 160_000,
  38: 190_000,
  39: 230_000,
  40: 300_000,
};

/** Доп. бонус на ранге 5, 10, 15, … */
export const RANK_MILESTONE_EXTRA: Readonly<Record<number, number>> = {
  5: 1000,
  10: 3000,
  15: 7000,
  20: 15_000,
  25: 30_000,
  30: 60_000,
  35: 120_000,
  40: 250_000,
};

export function computeRankFromLifetime(lifetimeEarned: number): number {
  const le = Math.max(0, Math.floor(lifetimeEarned));
  for (let r = MAX_RANK; r >= 1; r--) {
    if (le >= RANK_MIN_LIFETIME[r - 1]!) return r;
  }
  return 1;
}

export function rankProgress(lifetimeEarned: number): {
  rank: number;
  floorLifetime: number;
  nextThreshold: number | null;
  progressPercent: number;
} {
  const rank = computeRankFromLifetime(lifetimeEarned);
  const floorLifetime = RANK_MIN_LIFETIME[rank - 1] ?? 0;
  const nextThreshold = rank < MAX_RANK ? RANK_MIN_LIFETIME[rank]! : null;
  let progressPercent = 100;
  if (nextThreshold != null && nextThreshold > floorLifetime) {
    const p =
      ((lifetimeEarned - floorLifetime) / (nextThreshold - floorLifetime)) * 100;
    progressPercent = Math.max(0, Math.min(100, Math.round(p * 10) / 10));
  }
  return { rank, floorLifetime, nextThreshold, progressPercent };
}

/** Эмодзи стадии (1–10, 11–20, …). */
export function rankTierEmoji(rank: number): string {
  const r = Math.min(MAX_RANK, Math.max(1, rank));
  if (r <= 10) return "🌱";
  if (r <= 20) return "🔥";
  if (r <= 30) return "💎";
  return "👑";
}

export function rankTierLabelRu(rank: number): string {
  const r = Math.min(MAX_RANK, Math.max(1, rank));
  if (r <= 5) return "Новичок";
  if (r <= 10) return "Активист";
  if (r <= 15) return "Стример";
  if (r <= 20) return "Про";
  if (r <= 25) return "Мастер";
  if (r <= 30) return "Элита";
  if (r <= 35) return "Легенда";
  if (r <= 39) return "Божество";
  return "Топ";
}
