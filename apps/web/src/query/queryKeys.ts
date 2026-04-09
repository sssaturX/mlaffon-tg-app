/**
 * Нормализованные ключи: массивы от общего к частному.
 * Инвалидация: `["tasks"]` затронет все платформы; `queryKeys.tasks("twitch")` — точечно.
 */
export const queryKeys = {
  me: {
    all: ["me"] as const,
    profile: () => [...queryKeys.me.all, "profile"] as const,
    economy: () => [...queryKeys.me.all, "economy"] as const,
  },
  home: {
    all: ["home"] as const,
    content: () => [...queryKeys.home.all, "content"] as const,
    giveaways: () => [...queryKeys.home.all, "giveaways"] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    list: (platform: string) => [...queryKeys.tasks.all, platform] as const,
  },
  fortune: {
    all: ["games", "fortune"] as const,
    config: () => [...queryKeys.fortune.all, "config"] as const,
    state: () => [...queryKeys.fortune.all, "state"] as const,
  },
  /** REALTIME: снимок активного дропа (WS + HTTP catch-up). */
  drops: {
    all: ["drops"] as const,
    active: () => [...queryKeys.drops.all, "active"] as const,
  },
  liveBroadcast: {
    all: ["live-broadcast"] as const,
    current: () => [...queryKeys.liveBroadcast.all, "current"] as const,
  },
  predictions: {
    all: ["predictions"] as const,
    active: () => [...queryKeys.predictions.all, "active"] as const,
  },
  /** SEMI_STATIC */
  referrals: {
    all: ["referrals"] as const,
    list: () => [...queryKeys.referrals.all, "list"] as const,
  },
  giveaways: {
    all: ["giveaways"] as const,
    list: () => [...queryKeys.giveaways.all, "list"] as const,
    detail: (id: string) => [...queryKeys.giveaways.all, "detail", id] as const,
  },
  leaderboard: {
    all: ["leaderboard"] as const,
    entry: (sort: string, platform: string) =>
      [...queryKeys.leaderboard.all, sort, platform] as const,
  },
} as const;
