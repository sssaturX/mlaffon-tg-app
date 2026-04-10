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

/** Примеры скринов для HARD-заданий (URL от корня сайта, например /tasks/br/…). */
export interface TaskEvidenceExample {
  src: string;
  caption?: string;
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
  /** Сколько этапов цепочки уже пройдено (0 = ни одного, после 1-го = 1, …). UI: «0/2», «1/2». */
  hardStageCurrent?: number;
  hardStageTotal?: number;
  /** Группа на экране заданий (из meta.uiSection). */
  uiSection?: string | null;
  /** Порядок внутри группы (из meta.uiOrder). */
  uiOrder?: number;
  /** Нужны скрины + модерация перед получением награды. */
  requiresEvidence?: boolean;
  evidenceExamples?: TaskEvidenceExample[];
  /** Статус скринов для этапа этого задания (stage = hardStageCurrent+1). */
  evidenceStageStatus?: "none" | "submitted" | "approved" | "rejected";
  /** Комментарий админа при отклонении. */
  evidenceAdminNote?: string | null;
}

export type UserTaskStatus =
  | "locked"
  | "available"
  | "pending"
  | "completed"
  | "expired";

export type MePlatformsState = {
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

/** Профиль и привязки (без баланса/уровня/стрика). Кэш: semi-static. */
export interface MeProfileResponse {
  id: string;
  telegramId: string | null;
  email: string | null;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  referralCode: string;
  referralLinkMiniApp: string;
  referralLinkWeb: string;
  referralLink: string;
  referralCount: number;
  platforms: MePlatformsState;
  banned: boolean;
  banReason: string | null;
  banAppealPending: boolean;
  leaderboardRankCoins: number | null;
}

/** Баланс, прогресс и стрики. Основной источник обновлений — WebSocket. */
export interface MeEconomyResponse {
  coins: number;
  coinsTwitch: number;
  coinsKick: number;
  lifetimeEarned: number;
  lifetimeTwitch: number;
  lifetimeKick: number;
  level: number;
  rewardMultiplier: number;
  streak: number;
  streakTwitch: number;
  streakKick: number;
}

export function mergeMeProfileAndEconomy(
  profile: MeProfileResponse,
  economy: MeEconomyResponse
): MeResponse {
  return { ...profile, ...economy };
}

export interface HomeContentResponse {
  faq: { q: string; a: string }[];
}

export interface HomeGiveawayPublic {
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
}

export interface HomeGiveawaysResponse {
  giveaways: HomeGiveawayPublic[];
}

export interface FortuneConfigResponse {
  paidSpinCost: number;
  segments: {
    index: number;
    type: "coins" | "nothing";
    value?: number;
    label: string;
  }[];
}

export interface FortuneStateResponse {
  utcDate: string;
  freeAvailable: boolean;
}

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
  platforms: MePlatformsState;
  /** Доступ к приложению закрыт (кроме /me и апелляции). */
  banned: boolean;
  banReason: string | null;
  /** Отправлена апелляция, ожидает рассмотрения. */
  banAppealPending: boolean;
  /** Ранг в глобальном топе по сумме монет (Twitch+Kick). */
  leaderboardRankCoins: number | null;
}

/** Срез экономики из WS `me_update` / мутаций (совпадает с числовыми полями MeEconomyResponse). */
export interface MeEconomyPatch {
  coins: number;
  coinsTwitch: number;
  coinsKick: number;
  lifetimeEarned: number;
  lifetimeTwitch: number;
  lifetimeKick: number;
  level: number;
  rewardMultiplier: number;
  streak: number;
  streakTwitch: number;
  streakKick: number;
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
