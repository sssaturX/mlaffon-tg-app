import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { appSettings, giveaways, promoCodes, shopItems, tasks } from "./db/schema.js";

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

  const shopSeeds = [
    {
      id: "boost_x2",
      title: "Буст ×2 к награде",
      kind: "boost",
      priceCoins: 80,
      meta: { durationMinutes: 60 },
    },
    {
      id: "extra_spin_pack",
      title: "+3 спина колеса",
      kind: "extra_spin",
      priceCoins: 50,
      meta: { spins: 3 },
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
          active: true,
        })
        .where(eq(shopItems.id, s.id));
    } else {
      await db.insert(shopItems).values(s);
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
