import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { appSettings, giveaways, promoCodes, shopItems, tasks } from "./db/schema.js";
import { invalidateActiveTasksCache } from "./services/taskCatalogCache.js";

async function seed() {
  const taskSeeds = [
    {
      id: "daily_open",
      title: "Открыть приложение",
      description: "Зайди в мини-приложение сегодня",
      reward: 5,
      platform: "global",
      type: "daily",
      validationType: "manual",
    },
    {
      id: "onetime_profile",
      title: "Заполни профиль",
      description: "Подключи хотя бы одну платформу",
      reward: 25,
      platform: "global",
      type: "one-time",
      validationType: "manual",
    },
    {
      id: "invite_5",
      title: "Пригласи 5 друзей",
      description: "Цепочка Invite",
      reward: 60,
      platform: "global",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "invite",
        chainOrder: 1,
        progressSource: "referrals_total",
        targetValue: 5,
        progressLabel: "Друзья",
      },
    },
    {
      id: "invite_10",
      title: "Пригласи 10 друзей",
      description: "Цепочка Invite",
      reward: 120,
      platform: "global",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "invite",
        chainOrder: 2,
        progressSource: "referrals_total",
        targetValue: 10,
        progressLabel: "Друзья",
      },
    },
    {
      id: "streak_twitch_7",
      title: "7 стримов Twitch подряд",
      description: "Не пропускай эфиры",
      reward: 140,
      platform: "twitch",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "streams_twitch",
        chainOrder: 1,
        progressSource: "streak_twitch",
        targetValue: 7,
        progressLabel: "Стрик",
      },
    },
    {
      id: "streak_kick_7",
      title: "7 стримов Kick подряд",
      description: "Не пропускай эфиры",
      reward: 140,
      platform: "kick",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "streams_kick",
        chainOrder: 1,
        progressSource: "streak_kick",
        targetValue: 7,
        progressLabel: "Стрик",
      },
    },
    {
      id: "link_kick",
      title: "Привязать Kick аккаунт",
      description: "Нужен для кросс-задач",
      reward: 40,
      platform: "kick",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "subscriptions",
        chainOrder: 1,
        progressSource: "linked_kick",
        targetValue: 1,
        progressLabel: "Аккаунт",
      },
    },
    {
      id: "link_twitch",
      title: "Привязать Twitch аккаунт",
      description: "Нужен для кросс-задач",
      reward: 40,
      platform: "twitch",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "subscriptions",
        chainOrder: 2,
        progressSource: "linked_twitch",
        targetValue: 1,
        progressLabel: "Аккаунт",
      },
    },
    {
      id: "br_hard_stage_1",
      title: "BR регистрация",
      description: "Реф и 2 скрина",
      reward: 300,
      platform: "global",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "br_hard",
        chainOrder: 1,
        hard: true,
        hardStageCurrent: 0,
        hardStageTotal: 2,
        requiresEvidence: true,
      },
    },
    {
      id: "br_hard_stage_2",
      title: "BR уровень 5",
      description: "Скрин уровня/ника/сервера",
      reward: 500,
      platform: "global",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "br_hard",
        chainOrder: 2,
        hard: true,
        hardStageCurrent: 1,
        hardStageTotal: 2,
        requiresEvidence: true,
      },
    },
    {
      id: "tg_channel_sub",
      title: "Подписка Telegram канал",
      description: "Подпишись на канал",
      reward: 35,
      platform: "telegram",
      type: "one-time",
      validationType: "api",
      meta: {
        chainKey: "subscriptions",
        chainOrder: 3,
        telegram: { kind: "channel_member", chat_id: "@mlaffon_channel" },
        revokeOnUnsubscribe: true,
      },
    },
    {
      id: "tg_chat_sub",
      title: "Подписка Telegram чат",
      description: "Вступи в чат",
      reward: 35,
      platform: "telegram",
      type: "one-time",
      validationType: "api",
      meta: {
        chainKey: "subscriptions",
        chainOrder: 4,
        telegram: { kind: "chat_member", chat_id: "@mlaffon_chat" },
        revokeOnUnsubscribe: true,
      },
    },
    {
      id: "stream_msg_twitch_10",
      title: "10 сообщений на Twitch стриме",
      description: "Не чаще 1/мин",
      reward: 70,
      platform: "twitch",
      type: "daily",
      validationType: "manual",
      meta: {
        chainKey: "messages_twitch",
        chainOrder: 1,
        progressSource: "stream_messages_twitch",
        targetValue: 10,
        progressLabel: "Сообщения",
      },
    },
    {
      id: "stream_msg_kick_10",
      title: "10 сообщений на Kick стриме",
      description: "Не чаще 1/мин",
      reward: 70,
      platform: "kick",
      type: "daily",
      validationType: "manual",
      meta: {
        chainKey: "messages_kick",
        chainOrder: 1,
        progressSource: "stream_messages_kick",
        targetValue: 10,
        progressLabel: "Сообщения",
      },
    },
    {
      id: "daily_twitch_watch",
      title: "Смотри Twitch",
      description:
        "Подключи Twitch OAuth; награда после проверки Helix (по умолчанию — аккаунт привязан)",
      reward: 15,
      platform: "twitch",
      type: "daily",
      validationType: "api",
      meta: {
        helix: { kind: "connected" },
      },
    },
    {
      id: "daily_kick_watch",
      title: "Смотри Kick",
      description: "Подключи Kick OAuth; проверка API (или только привязка аккаунта)",
      reward: 15,
      platform: "kick",
      type: "daily",
      validationType: "api",
      meta: {
        kick: { kind: "connected" },
        actionUrl: "https://kick.com/",
        actionLabel: "Подписаться на Kick",
        verifyLabel: "Проверить подписку",
        help: {
          title: "Как получить награду",
          body: "Сначала открой канал по кнопке ниже, затем нажми «Проверить подписку».",
          icon: "tv",
        },
      },
    },
  ];

  for (const t of taskSeeds) {
    const [ex] = await db.select().from(tasks).where(eq(tasks.id, t.id)).limit(1);
    if (ex) {
      await db
        .update(tasks)
        .set({
          title: t.title,
          description: t.description,
          reward: t.reward,
          platform: t.platform,
          type: t.type,
          validationType: t.validationType,
          meta: "meta" in t ? t.meta : null,
          active: true,
        })
        .where(eq(tasks.id, t.id));
    } else {
      await db.insert(tasks).values({
        id: t.id,
        title: t.title,
        description: t.description,
        reward: t.reward,
        platform: t.platform,
        type: t.type,
        validationType: t.validationType,
        meta: "meta" in t ? t.meta : null,
        active: true,
      });
    }
  }
  invalidateActiveTasksCache();

  const shopSeeds = [
    {
      id: "extra_spin_pack",
      title: "+3 спина колеса",
      kind: "extra_spin" as const,
      priceCoins: 50,
      meta: { spins: 3 },
      active: true,
    },
  ];

  for (const s of shopSeeds) {
    const [ex] = await db
      .select()
      .from(shopItems)
      .where(eq(shopItems.id, s.id))
      .limit(1);
    if (ex) {
      await db
        .update(shopItems)
        .set({
          title: s.title,
          kind: s.kind,
          priceCoins: s.priceCoins,
          meta: s.meta,
          active: s.active,
        })
        .where(eq(shopItems.id, s.id));
    } else {
      await db.insert(shopItems).values({
        id: s.id,
        title: s.title,
        kind: s.kind,
        priceCoins: s.priceCoins,
        meta: s.meta,
        active: s.active,
      });
    }
  }

  const [gw0] = await db.select().from(giveaways).limit(1);
  if (!gw0) {
    const ends = new Date();
    ends.setUTCDate(ends.getUTCDate() + 14);
    await db.insert(giveaways).values({
      title: "Розыгрыш",
      prizeText: "200 000 ₽ на технику",
      imageUrl: null,
      endsAt: ends,
      active: true,
      sortOrder: 0,
    });
  }

  const [cash] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "cashback"))
    .limit(1);
  if (!cash) {
    await db.insert(appSettings).values({
      key: "cashback",
      value: {
        enabled: true,
        title: "Кэшбек Mlaffon",
        imageUrl: null,
        body: "Копите монеты на Twitch и Kick, обменивайте в магазине.",
      },
    });
  }

  const [faqRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "faq"))
    .limit(1);
  if (!faqRow) {
    await db.insert(appSettings).values({
      key: "faq",
      value: {
        items: [
          {
            q: "Как заработать монеты?",
            a: "Задания, стрики на стримах, колесо фортуны и реферальная программа.",
          },
          {
            q: "Когда начисляются реферальные проценты?",
            a: "Раз в неделю (понедельник UTC), после того как приглашённый подключил Twitch или Kick.",
          },
        ],
      },
    });
  }

  const [pc] = await db.select().from(promoCodes).where(eq(promoCodes.code, "WELCOME")).limit(1);
  if (!pc) {
    await db.insert(promoCodes).values({
      code: "WELCOME",
      rewardCoins: 50,
      maxUses: 10_000,
      usesCount: 0,
      active: true,
    });
  }

  console.log("Seed OK");
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
