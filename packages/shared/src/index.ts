export type Platform = "twitch" | "kick" | "global";
export type TaskType = "daily" | "one-time";
export type ValidationType = "api" | "manual";

export interface TaskDto {
  id: string;
  title: string;
  description: string;
  reward: number;
  platform: Platform;
  type: TaskType;
  validationType: ValidationType;
  userStatus: UserTaskStatus;
  periodKey?: string | null;
  /** Правила проверки API (Helix / Kick) */
  meta?: Record<string, unknown> | null;
  lastError?: string | null;
}

export type UserTaskStatus =
  | "locked"
  | "available"
  | "pending"
  | "completed"
  | "expired";

export interface MeResponse {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  /** Сумма Twitch + Kick (всего). */
  coins: number;
  coinsTwitch: number;
  coinsKick: number;
  lifetimeEarned: number;
  lifetimeTwitch: number;
  lifetimeKick: number;
  level: number;
  rewardMultiplier: number;
  /** Максимум из streakTwitch и streakKick (топ по стрику). */
  streak: number;
  /** Дней подряд с заходом на стрим Twitch (UTC). */
  streakTwitch: number;
  /** Дней подряд с заходом на стрим Kick (UTC). */
  streakKick: number;
  referralCode: string;
  referralLink: string;
  referralCount: number;
  platforms: {
    twitch:
      | { status: "not_connected" }
      | {
          status: "connected";
          displayName: string | null;
          avatarUrl: string | null;
        };
    kick:
      | { status: "not_connected" }
      | {
          status: "connected";
          displayName: string | null;
          avatarUrl: string | null;
        };
  };
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  value: number;
  photoUrl: string | null;
}

export interface LeaderboardResponse {
  sort: "coins" | "streak" | "referrals";
  platform: "all" | Platform;
  top: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

export interface ReferralRow {
  refereeId: string;
  displayName: string;
  createdAt: string;
  qualified: boolean;
}

export interface ReferralsResponse {
  referralLink: string;
  totalInvited: number;
  qualifiedCount: number;
  invited: ReferralRow[];
}
