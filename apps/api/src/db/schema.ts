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
import { relations } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    telegramId: bigint("telegram_id", { mode: "bigint" }).notNull().unique(),
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
  },
  (t) => [index("users_referred_by_idx").on(t.referredById)]
);

export const userBalances = pgTable("user_balances", {
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
});

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
  (t) => [uniqueIndex("platform_accounts_user_platform").on(t.userId, t.platform)]
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

export const giveaways = pgTable("giveaways", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  prizeText: text("prize_text").notNull(),
  /** Полное описание правил / призов (текст для карточки). */
  description: text("description"),
  imageUrl: text("image_url"),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Сколько победителей выбрать при розыгрыше. */
  winnerCount: integer("winner_count").notNull().default(1),
  /** Стоимость билета в монетах выбранной платформы; 0 = бесплатно. */
  ticketPriceCoins: integer("ticket_price_coins").notNull().default(0),
  /** Когда выполнен розыгрыш (победители выбраны). */
  drawnAt: timestamp("drawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
  kind: text("kind").notNull(),
  priceCoins: integer("price_coins").notNull(),
  meta: jsonb("meta"),
  active: boolean("active").notNull().default(true),
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
