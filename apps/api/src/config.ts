import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRankFromLifetime } from "./rankTable.js";

const __dir = dirname(fileURLToPath(import.meta.url));

export interface GameConfig {
  level: {
    /** level = floor(sqrt(lifetimeEarned / coinsPerLevelUnit)) */
    coinsPerLevelUnit: number;
    /** reward_multiplier = 1 + level * rewardMultiplierPerLevel */
    rewardMultiplierPerLevel: number;
  };
  streak: {
    /** Bonus coins every N days of streak (applied when crossing the day) */
    bonusEveryDays: number;
    bonusCoins: number;
  };
  /** Бонусы на конкретном счётчике стримов подряд (сессии) на Twitch/Kick. */
  streamStreak: {
    milestones: { streams: number; coins: number }[];
  };
  referral: {
    referrerReward: number;
    refereeBonus: number;
    qualifyMinLifetimeEarned: number;
    /** Доля от недельного оборота реферала (после подключения Twitch/Kick). */
    weeklyPercentL1: number;
    weeklyPercentL2: number;
  };
  fortune: {
    paidSpinCost: number;
    outcomes: {
      type: "coins" | "boost" | "nothing" | "streak_save" | "streak_plus";
      weight: number;
      value?: number;
    }[];
  };
  platforms: {
    twitchEnabled: boolean;
    kickEnabled: boolean;
  };
  rateLimit: {
    maxPerWindow: number;
    timeWindowMs: number;
  };
  /** Ужесточённые лимиты для отдельных сценариев (поверх глобального rate-limit). */
  routeRateLimits: {
    dropsAttempt: { max: number; timeWindowMs: number };
    promoApply: { max: number; timeWindowMs: number };
    giveawayJoin: { max: number; timeWindowMs: number };
    giveawayBoost: { max: number; timeWindowMs: number };
    predictionBet: { max: number; timeWindowMs: number };
    fortuneSpin: { max: number; timeWindowMs: number };
    /** Ручная синхронизация недельных % рефералов (отдельный бакет, не глобальный). */
    referralWeeklySync: { max: number; timeWindowMs: number };
  };
  /** Множитель к наградам при заряде в инвентаре (см. inventoryItemId). Не выше maxMultiplier. */
  boost: {
    maxMultiplier: number;
    inventoryItemId: string;
  };
}

const defaultConfig: GameConfig = {
  level: {
    coinsPerLevelUnit: 100,
    rewardMultiplierPerLevel: 0.05,
  },
  streak: {
    bonusEveryDays: 7,
    bonusCoins: 50,
  },
  streamStreak: {
    milestones: [
      { streams: 3, coins: 300 },
      { streams: 5, coins: 500 },
      { streams: 7, coins: 800 },
      { streams: 10, coins: 1300 },
      { streams: 15, coins: 2000 },
      { streams: 21, coins: 3200 },
      { streams: 30, coins: 5000 },
      { streams: 50, coins: 12_000 },
      { streams: 100, coins: 35_000 },
    ],
  },
  referral: {
    referrerReward: 0,
    refereeBonus: 25,
    qualifyMinLifetimeEarned: 50,
    weeklyPercentL1: 0.02,
    weeklyPercentL2: 0.005,
  },
  fortune: {
    paidSpinCost: 20,
    outcomes: [
      { type: "coins", weight: 35, value: 10 },
      { type: "coins", weight: 25, value: 25 },
      { type: "coins", weight: 10, value: 50 },
      { type: "boost", weight: 12, value: 1 },
      { type: "streak_save", weight: 5 },
      { type: "streak_plus", weight: 5 },
      { type: "nothing", weight: 13 },
    ],
  },
  platforms: {
    twitchEnabled: true,
    kickEnabled: true,
  },
  rateLimit: {
    maxPerWindow: 200,
    timeWindowMs: 60_000,
  },
  routeRateLimits: {
    dropsAttempt: { max: 20, timeWindowMs: 60_000 },
    promoApply: { max: 15, timeWindowMs: 60_000 },
    giveawayJoin: { max: 30, timeWindowMs: 60_000 },
    giveawayBoost: { max: 20, timeWindowMs: 60_000 },
    predictionBet: { max: 12, timeWindowMs: 60_000 },
    fortuneSpin: { max: 25, timeWindowMs: 60_000 },
    referralWeeklySync: { max: 30, timeWindowMs: 60_000 },
  },
  boost: {
    maxMultiplier: 2,
    inventoryItemId: "boost_x2",
  },
};

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    const bv = base[key];
    if (
      ov != null &&
      typeof ov === "object" &&
      !Array.isArray(ov) &&
      bv != null &&
      typeof bv === "object" &&
      !Array.isArray(bv)
    ) {
      result[key] = deepMerge(
        bv as Record<string, unknown>,
        ov as Record<string, unknown>
      );
    } else if (ov !== undefined) {
      result[key] = ov;
    }
  }
  return result;
}

function loadConfig(): GameConfig {
  try {
    const path = join(__dir, "game.config.json");
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<GameConfig>;
    return deepMerge(
      defaultConfig as unknown as Record<string, unknown>,
      parsed as unknown as Record<string, unknown>
    ) as unknown as GameConfig;
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: string }).code === "ENOENT"
    ) {
      return defaultConfig;
    }
    console.warn("config: failed to load game.config.json, using defaults", e);
    return defaultConfig;
  }
}

export const gameConfig = loadConfig();

/** Ранг 1–40 по суммарному lifetime (таблица заказчика). */
export function computeLevel(lifetimeEarned: number): number {
  return computeRankFromLifetime(lifetimeEarned);
}

export function computeRewardMultiplier(level: number): number {
  const r = Math.max(1, level);
  return 1 + (r - 1) * gameConfig.level.rewardMultiplierPerLevel;
}
