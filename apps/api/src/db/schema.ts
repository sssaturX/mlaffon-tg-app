import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  uuid,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** null — только веб-аккаунт до привязки Telegram */
    telegramId: bigint("telegram_id", { mode: "bigint" }),
    /** Вход с сайта; уникален среди непустых */
    email: text("email"),
    passwordHash: text("password_hash"),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    photoUrl: text("photo_url"),
    referralCode: text("referral_code").notNull().unique(),
    /** FK users.id — без .references() из-за циклического вывода типов TS */
    referredById: uuid("referred_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Блокировка доступа к API мини-приложения */
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
  },
  (t) => [
    index("users_referred_by_idx").on(t.referredById),
    uniqueIndex("users_telegram_id_uidx")
      .on(t.telegramId)
      .where(sql`${t.telegramId} IS NOT NULL`),
    uniqueIndex("users_email_uidx")
      .on(t.email)
      .where(sql`${t.email} IS NOT NULL`),
  ]
);

/** Одноразовая привязка Telegram к веб-аккаунту (start_param link_*) */
export const accountLinkTokens = pgTable(
  "account_link_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("account_link_tokens_user_idx").on(t.userId)]
);

export const userBalances = pgTable(
  "user_balances",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Сумма twitch + kick (дублируем для совместимости и топов). */
    coins: integer("coins").notNull().default(0),
    lifetimeEarned: integer("lifetime_earned").notNull().default(0),
    twitchCoins: integer("twitch_coins").notNull().default(0),
    kickCoins: integer("kick_coins").notNull().default(0),
    twitchLifetimeEarned: integer("twitch_lifetime_earned").notNull().default(0),
    kickLifetimeEarned: integer("kick_lifetime_earned").notNull().default(0),
  },
  (t) => [
    index("user_balances_coins_idx").on(t.coins),
    index("user_balances_twitch_coins_idx").on(t.twitchCoins),
    index("user_balances_kick_coins_idx").on(t.kickCoins),
  ]
);

/**
 * Справочник платформ поинтов для фич с изолированными балансами.
 * Для twitch/kick используем legacy-колонки user_balances, для остальных — user_platform_balances.
 */
export const pointPlatforms = pgTable(
  "point_platforms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("point_platforms_name_uidx").on(t.name)]
);

export const userPlatformBalances = pgTable(
  "user_platform_balances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => pointPlatforms.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("user_platform_balances_user_platform_uidx").on(
      t.userId,
      t.platformId
    ),
    index("user_platform_balances_platform_idx").on(t.platformId),
  ]
);

export const userStreaks = pgTable("user_streaks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentStreak: integer("current_streak").notNull().default(0),
  lastActivityUtcDate: text("last_activity_utc_date"),
});

/** Стрик «был на стриме» отдельно по Twitch и Kick (UTC-день). */
export const userStreamStreaks = pgTable("user_stream_streaks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  twitchCurrent: integer("twitch_current").notNull().default(0),
  twitchLastUtcDate: text("twitch_last_utc_date"),
  kickCurrent: integer("kick_current").notNull().default(0),
  kickLastUtcDate: text("kick_last_utc_date"),
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  reward: integer("reward").notNull(),
  platform: text("platform").notNull(),
  type: text("type").notNull(),
  validationType: text("validation_type").notNull(),
  /** Правила Helix/Kick: { helix?: {...}, kick?: {...} } */
  meta: jsonb("meta"),
  active: boolean("active").notNull().default(true),
});

export const userTasks = pgTable(
  "user_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    periodKey: text("period_key"),
    rewardGranted: integer("reward_granted").notNull().default(0),
    rewardPlatform: text("reward_platform"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("user_tasks_unique_daily").on(t.userId, t.taskId, t.periodKey),
  ]
);

export const taskStreamMessages = pgTable(
  "task_stream_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    broadcastId: text("broadcast_id").notNull(),
    minuteKey: text("minute_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("task_stream_messages_user_platform_minute_uidx").on(
      t.userId,
      t.platform,
      t.minuteKey
    ),
    index("task_stream_messages_user_platform_idx").on(t.userId, t.platform),
  ]
);

export const taskEvidence = pgTable(
  "task_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    stage: integer("stage").notNull().default(1),
    status: text("status").notNull().default("submitted"),
    images: jsonb("images").notNull(),
    note: text("note"),
    adminNote: text("admin_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("task_evidence_user_task_stage_uidx").on(t.userId, t.taskId, t.stage),
    index("task_evidence_task_status_idx").on(t.taskId, t.status),
  ]
);

export const userSecurityFingerprints = pgTable(
  "user_security_fingerprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    deviceHash: text("device_hash").notNull(),
    userAgent: text("user_agent"),
    seenCount: integer("seen_count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("user_security_fingerprint_unique").on(t.userId, t.ip, t.deviceHash),
    index("user_security_fingerprint_device_idx").on(t.deviceHash),
  ]
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    kind: text("kind").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("transactions_user_idx").on(t.userId)]
);

export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    externalUserId: text("external_user_id"),
    displayName: text("display_name"),
    /** URL аватара с платформы (OAuth / API). */
    avatarUrl: text("avatar_url"),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    /** OAuth scopes granted */
    scopes: jsonb("scopes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("platform_accounts_user_platform").on(t.userId, t.platform),
    uniqueIndex("platform_accounts_platform_external_unique")
      .on(t.platform, t.externalUserId)
      .where(
        sql`${t.externalUserId} is not null and ${t.externalUserId} <> 'unknown'`
      ),
  ]
);

/** Активный эфир: один ряд с ended_at = null (завершение = выставить ended_at). */
export const liveBroadcasts = pgTable(
  "live_broadcasts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: text("platform").notNull(),
    streamUrl: text("stream_url").notNull(),
    vpnNote: text("vpn_note"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("live_broadcasts_ended_idx").on(t.endedAt)]
);

export const liveBroadcastViews = pgTable(
  "live_broadcast_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => liveBroadcasts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("live_broadcast_views_broadcast_user").on(
      t.broadcastId,
      t.userId
    ),
    index("live_broadcast_views_user_idx").on(t.userId),
  ]
);

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referrerId: uuid("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refereeId: uuid("referee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .unique(),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    /** Реферал учитывается в % после подключения Twitch или Kick. */
    eligibleForPercentAt: timestamp("eligible_for_percent_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("referrals_referrer_idx").on(t.referrerId)]
);

export const giveaways = pgTable(
  "giveaways",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    prizeText: text("prize_text").notNull(),
    /** twitch | kick | both — для каких платформ доступен розыгрыш */
    platform: text("platform").notNull().default("both"),
    /** Полное описание правил / призов (текст для карточки). */
    description: text("description"),
    imageUrl: text("image_url"),
    /** Набор URL после медиа-пайплайна (AVIF/WebP/JPEG + LQIP) для `<picture>` в приложении. */
    imageMedia: jsonb("image_media"),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Сколько победителей выбрать при розыгрыше. */
    winnerCount: integer("winner_count").notNull().default(1),
    /**
     * random — честный выбор среди участников;
     * predetermined — сначала фиксированный список user id (только те, кто реально участвовал),
     * недостающие места добираются случайно из остальных участников.
     */
    winnerPickMode: text("winner_pick_mode").notNull().default("random"),
    /** UUID пользователей в желаемом порядке мест (1..n); не публикуется до drawnAt. */
    predeterminedWinnerUserIds: jsonb("predetermined_winner_user_ids").$type<
      string[] | null
    >(),
    /** Стоимость билета в монетах выбранной платформы; 0 = бесплатно. */
    ticketPriceCoins: integer("ticket_price_coins").notNull().default(0),
    /** Когда выполнен розыгрыш (победители выбраны). */
    drawnAt: timestamp("drawn_at", { withTimezone: true }),
    /** Требовать подписку на Telegram-канал для участия (проверка через бота). */
    requireChannelSubscription: boolean("require_channel_subscription")
      .notNull()
      .default(false),
    /** @channelname или -100… — для getChatMember (бот должен быть в канале). */
    telegramChannelId: text("telegram_channel_id"),
    /** Ссылка для пользователя (t.me/…). */
    channelInviteUrl: text("channel_invite_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("giveaways_pending_draw_idx").on(t.endsAt)]
);

export const giveawayParticipants = pgTable(
  "giveaway_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    giveawayId: uuid("giveaway_id")
      .notNull()
      .references(() => giveaways.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("giveaway_participants_gw_user").on(t.giveawayId, t.userId),
    index("giveaway_participants_gw_idx").on(t.giveawayId),
  ]
);

export const giveawayWinners = pgTable(
  "giveaway_winners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    giveawayId: uuid("giveaway_id")
      .notNull()
      .references(() => giveaways.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 1 — первое место, 2 — второе, … */
    rank: integer("rank").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("giveaway_winners_gw_user").on(t.giveawayId, t.userId),
    index("giveaway_winners_gw_idx").on(t.giveawayId),
  ]
);

export const giveawayBoosts = pgTable(
  "giveaway_boosts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    giveawayId: uuid("giveaway_id")
      .notNull()
      .references(() => giveaways.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platformType: text("platform_type").notNull(),
    pointsSpent: integer("points_spent").notNull().default(0),
    ticketsAdded: integer("tickets_added").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("giveaway_boosts_giveaway_idx").on(t.giveawayId),
    index("giveaway_boosts_user_idx").on(t.userId),
  ]
);

export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    optionA: text("option_a").notNull(),
    optionB: text("option_b").notNull(),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => pointPlatforms.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("draft"),
    bettingDurationSec: integer("betting_duration_sec").notNull().default(60),
    startAt: timestamp("start_at", { withTimezone: true }),
    autoCloseAt: timestamp("auto_close_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    winnerOption: text("winner_option"),
    totalPool: integer("total_pool").notNull().default(0),
    optionAPool: integer("option_a_pool").notNull().default(0),
    optionBPool: integer("option_b_pool").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("predictions_status_idx").on(t.status),
    index("predictions_platform_idx").on(t.platformId),
    uniqueIndex("predictions_single_active_uidx")
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
  ]
);

/** Транзакционный outbox для broadcast в Redis (см. services/outboxFlush.ts). */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    event: jsonb("event").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("outbox_events_created_idx").on(t.createdAt)]
);

export const predictionBets = pgTable(
  "prediction_bets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    predictionId: uuid("prediction_id")
      .notNull()
      .references(() => predictions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    option: text("option").notNull(),
    amount: integer("amount").notNull(),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => pointPlatforms.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("prediction_bets_prediction_idx").on(t.predictionId),
    index("prediction_bets_prediction_user_idx").on(t.predictionId, t.userId),
  ]
);

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Неуникальное имя для админки; уникален только code */
    displayName: text("display_name"),
    code: text("code").notNull().unique(),
    rewardCoins: integer("reward_coins").notNull(),
    /** split — 50/50 Twitch/Kick; twitch / kick — весь бонус на счёт платформы. */
    creditPlatform: text("credit_platform").notNull().default("split"),
    maxUses: integer("max_uses").notNull().default(1),
    usesCount: integer("uses_count").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("promo_codes_active_idx").on(t.active)]
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promoId: uuid("promo_id")
      .notNull()
      .references(() => promoCodes.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("promo_redemptions_user_promo").on(t.userId, t.promoId)]
);

export const drops = pgTable(
  "drops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** twitch | kick | both — награда на счёт платформы (both = split 50/50, нужны обе привязки). */
    platform: text("platform").notNull().default("both"),
    /** Код со стрима (обычно 4 цифры). */
    code: text("code").notNull(),
    rewardMin: integer("reward_min").notNull(),
    rewardMax: integer("reward_max").notNull(),
    maxWinners: integer("max_winners").notNull(),
    winnersCount: integer("winners_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("drops_active_idx").on(t.active)]
);

export const dropUserStates = pgTable(
  "drop_user_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dropId: uuid("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attemptsCount: integer("attempts_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    won: boolean("won").notNull().default(false),
    rewardCoins: integer("reward_coins"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("drop_user_states_drop_user").on(t.dropId, t.userId),
    index("drop_user_states_user_idx").on(t.userId),
  ]
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const shopItems = pgTable("shop_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  /** Текст для карточки товара в приложении. */
  description: text("description"),
  /** URL картинки для карточки товара. */
  imageUrl: text("image_url"),
  kind: text("kind").notNull(),
  priceCoins: integer("price_coins").notNull(),
  meta: jsonb("meta"),
  active: boolean("active").notNull().default(true),
  /** Лимит продаж: null = без лимита. */
  stockTotal: integer("stock_total"),
  /** Сколько единиц уже продано (покупок). */
  stockSold: integer("stock_sold").notNull().default(0),
});

export const userInventory = pgTable(
  "user_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => shopItems.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("user_inventory_unique").on(t.userId, t.itemId)]
);

/** Факт покупки в магазине (для выдачи призов / учёта). */
export const shopPurchases = pgTable(
  "shop_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** После удаления товара из каталога обнуляется (ON DELETE SET NULL); название остаётся в `itemTitleSnapshot`. */
    shopItemId: text("shop_item_id").references(() => shopItems.id, {
      onDelete: "set null",
    }),
    /** Название товара на момент покупки / перед удалением карточки (для отчётов). */
    itemTitleSnapshot: text("item_title_snapshot").notNull().default(""),
    priceCoins: integer("price_coins").notNull(),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("shop_purchases_user_idx").on(t.userId),
    index("shop_purchases_item_idx").on(t.shopItemId),
    index("shop_purchases_created_idx").on(t.createdAt),
  ]
);

export const fortuneSpins = pgTable(
  "fortune_spins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    utcDate: text("utc_date").notNull(),
    freeUsed: boolean("free_used").notNull().default(false),
    paidCount: integer("paid_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("fortune_spins_user_day").on(t.userId, t.utcDate)]
);

/** Web Push (VAPID): одна строка на устройство/браузер. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)]
);

/** Апелляции на блокировку — текст для админа. */
export const banAppeals = pgTable(
  "ban_appeals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    status: text("status").notNull().default("pending"),
    adminNote: text("admin_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("ban_appeals_user_status_idx").on(t.userId, t.status)]
);

/**
 * Личные чаты с ботом: нажали /start — получают уведомление при старте эфира из админки.
 * chat_id для лички совпадает с telegram user id.
 */
export const telegramLiveNotifySubscribers = pgTable(
  "telegram_live_notify_subscribers",
  {
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).primaryKey(),
    chatId: bigint("chat_id", { mode: "bigint" }).notNull(),
    /** @username без @, если пользователь задал username в Telegram */
    telegramUsername: text("telegram_username"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("telegram_live_notify_subscribers_active_idx").on(t.active)]
);

export const admins = pgTable(
  "admins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    passphraseHash: text("passphrase_hash").notNull(),
    role: text("role").notNull().default("viewer"),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("admins_email_idx").on(t.email)]
);

export type AdminRole = "super_admin" | "moderator" | "viewer";

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    payload: jsonb("payload"),
    ip: text("ip"),
    role: text("role"),
    requestId: text("request_id"),
    success: boolean("success").default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("admin_audit_log_created_idx").on(t.createdAt),
    index("admin_audit_log_action_idx").on(t.action),
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  balance: one(userBalances, {
    fields: [users.id],
    references: [userBalances.userId],
  }),
  streak: one(userStreaks, {
    fields: [users.id],
    references: [userStreaks.userId],
  }),
  streamStreak: one(userStreamStreaks, {
    fields: [users.id],
    references: [userStreamStreaks.userId],
  }),
  platformAccounts: many(platformAccounts),
}));
