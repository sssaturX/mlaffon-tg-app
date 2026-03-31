import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  /** Бонус за N стримов подряд на Twitch или Kick (отдельно от ежедневного стрика захода в приложение). */
  streamStreak: {
    bonusEveryStreams: number;
    bonusCoins: number;
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
    outcomes: { type: "coins" | "boost" | "nothing"; weight: number; value?: number }[];
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
    fortuneSpin: { max: number; timeWindowMs: number };
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
    bonusEveryStreams: 7,
    bonusCoins: 500,
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
      { type: "boost", weight: 15, value: 1 },
      { type: "nothing", weight: 15 },
    ],
  },
  platforms: {
    twitchEnabled: true,
    kickEnabled: true,
  },
  rateLimit: {
    maxPerWindow: 120,
    timeWindowMs: 60_000,
  },
  routeRateLimits: {
    dropsAttempt: { max: 20, timeWindowMs: 60_000 },
    promoApply: { max: 15, timeWindowMs: 60_000 },
    giveawayJoin: { max: 30, timeWindowMs: 60_000 },
    fortuneSpin: { max: 25, timeWindowMs: 60_000 },
  },
  boost: {
    maxMultiplier: 2,
    inventoryItemId: "boost_x2",
  },
};

function loadConfig(): GameConfig {
  try {
    const path = join(__dir, "game.config.json");
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<GameConfig>;
    return {
      ...defaultConfig,
      ...parsed,
      routeRateLimits: {
        ...defaultConfig.routeRateLimits,
        ...parsed.routeRateLimits,
      },
    };
  } catch {
    return defaultConfig;
  }
}

export const gameConfig = loadConfig();

export function computeLevel(lifetimeEarned: number): number {
  const u = gameConfig.level.coinsPerLevelUnit;
  return Math.floor(Math.sqrt(Math.max(0, lifetimeEarned) / u));
}

export function computeRewardMultiplier(level: number): number {
  return 1 + level * gameConfig.level.rewardMultiplierPerLevel;
}
