export type Platform = "twitch" | "kick" | "global" | "telegram";
export type TaskType = "daily" | "one-time";
export type ValidationType = "api" | "manual";

/** Иконка в блоке справки (модалка «как на третьем скрине»). */
export type TaskHelpIcon = "tv" | "gift" | "help" | "radio";

export interface TaskHelpHint {
  title: string;
  body: string;
  icon?: TaskHelpIcon;
}

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
  /** Правила проверки API (Helix / Kick) + UI-поля (actionUrl, help, …) */
  meta?: Record<string, unknown> | null;
  lastError?: string | null;
  /** Ссылка для кнопки «Подписаться» / открыть канал (из meta.actionUrl). */
  actionUrl?: string | null;
  /** Текст кнопки внешнего действия (из meta.actionLabel). */
  actionLabel?: string | null;
  /** Текст кнопки проверки / получения награды (из meta.verifyLabel). */
  verifyLabel?: string | null;
  /** Справка в стиле отдельной модалки (из meta.help). */
  help?: TaskHelpHint | null;
  /** Единый прогресс для цепочек (invite/streams/messages/subscriptions). */
  progressCurrent?: number;
  progressTarget?: number;
  progressLabel?: string | null;
  /** Логическая категория цепочки, чтобы UI не дёргался при замене этапа. */
  chainKey?: string | null;
  /** Для визуального выделения сложных задач (например BR). */
  hard?: boolean;
  /** Для staged hard-задач (пример: 0/2, 1/2, 2/2). */
  hardStageCurrent?: number;
  hardStageTotal?: number;
}

export type UserTaskStatus =
  | "locked"
  | "available"
  | "pending"
  | "completed"
  | "expired";

export interface MeResponse {
  id: string;
  /** null — только веб, до привязки Telegram */
  telegramId: string | null;
  /** Email для входа с сайта */
  email: string | null;
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
  rankTierEmoji: string;
  rankTierLabel: string;
  rankProgressPercent: number;
  rankLifetimeToNext: number | null;
  /** Максимум из streakTwitch и streakKick (топ по стрику). */
  streak: number;
  /** Дней подряд с заходом на стрим Twitch (UTC). */
  streakTwitch: number;
  /** Дней подряд с заходом на стрим Kick (UTC). */
  streakKick: number;
  referralCode: string;
  /** Мини-приложение: `t.me/...?startapp=ref_*` */
  referralLinkMiniApp: string;
  /** Сайт: главная с `?ref=` для регистрации в браузере */
  referralLinkWeb: string;
  /** Совместимость: то же, что referralLinkMiniApp */
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
  /** Доступ к приложению закрыт (кроме /me и апелляции). */
  banned: boolean;
  banReason: string | null;
  /** Отправлена апелляция, ожидает рассмотрения. */
  banAppealPending: boolean;
  /** Ранг в глобальном топе по сумме монет (Twitch+Kick). */
  leaderboardRankCoins: number | null;
}

/** Фрагмент профиля из WS `me_update` после экономики. */
export interface MeEconomyPatch {
  coins: number;
  coinsTwitch: number;
  coinsKick: number;
  lifetimeEarned: number;
  lifetimeTwitch: number;
  lifetimeKick: number;
  level: number;
  rewardMultiplier: number;
  rankTierEmoji: string;
  rankTierLabel: string;
  rankProgressPercent: number;
  rankLifetimeToNext: number | null;
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
  referralLinkMiniApp: string;
  referralLinkWeb: string;
  totalInvited: number;
  qualifiedCount: number;
  invited: ReferralRow[];
}
