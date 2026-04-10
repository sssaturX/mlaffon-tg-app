import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { appSettings, giveaways, promoCodes, shopItems, tasks } from "./db/schema.js";
import { invalidateActiveTasksCache } from "./services/taskCatalogCache.js";

/** Официальный канал для API-заданий follow (Twitch login / Kick slug в URL). */
const OFFICIAL_TWITCH_BROADCASTER_LOGIN = "mlaffonxd";
const OFFICIAL_KICK_CHANNEL_SLUG = "mlaffonxd";

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
      id: "invite_3",
      title: "Друзья",
      description:
        "Пригласи друзей по своей реферальной ссылке и получай бонусы со своих рефералов. Позже цель сможет расти с уровнем (3 → 5 → 10 …).",
      reward: 45,
      platform: "global",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "invite",
        chainOrder: 0,
        progressSource: "referrals_total",
        targetValue: 3,
        progressLabel: "Друзья",
        uiSection: "stream_tasks",
        uiOrder: 50,
      },
    },
    {
      id: "invite_5",
      title: "Друзья",
      description:
        "Пригласи друзей по своей реферальной ссылке и получай бонусы со своих рефералов.",
      reward: 80,
      platform: "global",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "invite",
        chainOrder: 1,
        progressSource: "referrals_total",
        targetValue: 5,
        progressLabel: "Друзья",
        uiSection: "stream_tasks",
        uiOrder: 50,
      },
    },
    {
      id: "invite_10",
      title: "Друзья",
      description:
        "Пригласи друзей по своей реферальной ссылке и получай бонусы со своих рефералов.",
      reward: 150,
      platform: "global",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "invite",
        chainOrder: 2,
        progressSource: "referrals_total",
        targetValue: 10,
        progressLabel: "Друзья",
        uiSection: "stream_tasks",
        uiOrder: 50,
      },
    },
    {
      id: "streak_twitch_7",
      title: "Посети свои первые 7 стримов подряд",
      description:
        "Посети 7 стримов подряд и забери награду (если пропустишь — начнёшь заново).",
      reward: 600,
      platform: "twitch",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "streams_twitch",
        chainOrder: 1,
        progressSource: "streak_twitch",
        targetValue: 7,
        progressLabel: "Стримы подряд",
        uiSection: "stream_tasks",
        uiOrder: 70,
      },
    },
    {
      id: "streak_kick_7",
      title: "Посети свои первые 7 стримов подряд",
      description:
        "Посети 7 стримов подряд и забери награду (если пропустишь — начнёшь заново).",
      reward: 600,
      platform: "kick",
      type: "one-time",
      validationType: "manual",
      meta: {
        chainKey: "streams_kick",
        chainOrder: 1,
        progressSource: "streak_kick",
        targetValue: 7,
        progressLabel: "Стримы подряд",
        uiSection: "stream_tasks",
        uiOrder: 70,
      },
    },
    {
      id: "link_kick",
      title: "Привязать Kick",
      description: "Привяжи свой Kick-аккаунт в приложении.",
      reward: 40,
      platform: "kick",
      type: "one-time",
      validationType: "manual",
      meta: {
        progressSource: "linked_kick",
        targetValue: 1,
        progressLabel: "Аккаунт",
        uiSection: "stream_tasks",
        uiOrder: 35,
      },
    },
    {
      id: "link_twitch",
      title: "Привязать Twitch",
      description: "Привяжи свой Twitch-аккаунт в приложении.",
      reward: 200,
      platform: "twitch",
      type: "one-time",
      validationType: "manual",
      meta: {
        progressSource: "linked_twitch",
        targetValue: 1,
        progressLabel: "Аккаунт",
        uiSection: "stream_tasks",
        uiOrder: 40,
      },
    },
    {
      id: "br_hard_stage_1",
      title: "РЕГИСТРАЦИЯ И ВХОД",
      description:
        "Зарегистрируйся по ссылке, зайди в игру и отправь 2 скриншота.\n\nСсылка: https://blackrussia.online/registration?n=mlaffon\n\nЧто сделать:\n• Зарегистрироваться по ссылке\n• Отправить скрин, где видна регистрация (сайт / аккаунт)\n• Зайти в игру\n• Отправить второй скрин: ник, сервер, что ты в игре\n\nВажно: нужны оба скрина; без них задание не засчитывается. Второе задание откроется только после этого.",
      reward: 550,
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
        actionUrl: "https://blackrussia.online/registration?n=mlaffon",
        actionLabel: "Регистрация Black Russia",
        uiSection: "black_russia",
        uiOrder: 0,
        evidenceExamples: [
          {
            src: "/tasks/br/stage1-reg.webp",
            caption: "Пример 1: регистрация / аккаунт по ссылке",
          },
          {
            src: "/tasks/br/stage1%262level.webp",
            caption: "Пример 2: ник, сервер, в игре",
          },
        ],
      },
    },
    {
      id: "br_hard_stage_2",
      title: "5 УРОВЕНЬ",
      description:
        "Достигни 5 уровня, отправь скриншот и зайди в семью (принимаем во время стрима).\n\nЧто сделать:\n• Прокачать аккаунт до 5 уровня\n• Отправить скрин: уровень, ник, сервер\n• Зайти в семью на стриме\n\nВажно: уровень должен быть чётко виден; без скрина задание не засчитывается.",
      reward: 1250,
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
        uiSection: "black_russia",
        uiOrder: 1,
        evidenceExamples: [
          {
            src: "/tasks/br/stage1%262level.webp",
            caption: "Пример: уровень 5, ник и сервер хорошо видны",
          },
        ],
      },
    },
    {
      id: "tg_channel_sub",
      title: "Подписаться на Telegram",
      description:
        "Подпишись на канал Mlaffonxd (при отписке монеты будут списаны).",
      reward: 500,
      platform: "telegram",
      type: "one-time",
      validationType: "api",
      meta: {
        telegram: { kind: "channel_member", chat_id: "@Mlaffonxd" },
        revokeOnUnsubscribe: true,
        actionUrl: "https://t.me/Mlaffonxd",
        actionLabel: "Открыть канал Telegram",
        verifyLabel: "Проверить подписку",
        uiSection: "stream_tasks",
        uiOrder: 20,
      },
    },
    {
      id: "tg_chat_sub",
      title: "Подписка Telegram чат (архив)",
      description: "Не используется в новом списке.",
      reward: 0,
      platform: "telegram",
      type: "one-time",
      validationType: "api",
      active: false,
      meta: {
        telegram: { kind: "chat_member", chat_id: "@mlaffon_chat" },
        revokeOnUnsubscribe: true,
      },
    },
    {
      id: "twitch_first_open",
      title: "Зайди в приложение первый раз",
      description: "Открой мини-приложение один раз и забери бонус.",
      reward: 75,
      platform: "twitch",
      type: "one-time",
      validationType: "manual",
      meta: {
        uiSection: "stream_tasks",
        uiOrder: 25,
      },
    },
    {
      id: "stream_msg_twitch_10",
      title: "Зайди на стрим",
      description:
        "Зайди на стрим и напиши сообщение в чате (не чаще 1 раза в минуту).",
      reward: 100,
      platform: "twitch",
      type: "daily",
      validationType: "manual",
      meta: {
        chainKey: "messages_twitch",
        chainOrder: 1,
        progressSource: "stream_messages_twitch",
        targetValue: 1,
        progressLabel: "Сообщения",
        uiSection: "stream_tasks",
        uiOrder: 60,
      },
    },
    {
      id: "stream_msg_kick_10",
      title: "Зайди на стрим",
      description:
        "Зайди на стрим и напиши сообщение в чате (не чаще 1 раза в минуту).",
      reward: 100,
      platform: "kick",
      type: "daily",
      validationType: "manual",
      meta: {
        chainKey: "messages_kick",
        chainOrder: 1,
        progressSource: "stream_messages_kick",
        targetValue: 1,
        progressLabel: "Сообщения",
        uiSection: "stream_tasks",
        uiOrder: 60,
      },
    },
    {
      id: "daily_twitch_watch",
      title: "Подписаться на Twitch",
      description: `Подпишись на Twitch канал ${OFFICIAL_TWITCH_BROADCASTER_LOGIN} (при отписке монеты будут списаны).`,
      reward: 300,
      platform: "twitch",
      type: "daily",
      validationType: "api",
      meta: {
        helix: {
          kind: "follow",
          broadcaster_login: OFFICIAL_TWITCH_BROADCASTER_LOGIN,
        },
        actionUrl: `https://www.twitch.tv/${OFFICIAL_TWITCH_BROADCASTER_LOGIN}`,
        actionLabel: "Открыть Twitch",
        verifyLabel: "Проверить подписку",
        uiSection: "stream_tasks",
        uiOrder: 10,
        help: {
          title: "Как получить награду",
          body: `Открой twitch.tv/${OFFICIAL_TWITCH_BROADCASTER_LOGIN}, подпишись на канал, затем «Проверить подписку». Нужен OAuth с правами на подписки.`,
          icon: "tv",
        },
      },
    },
    {
      id: "daily_kick_watch",
      title: "Подписаться на Kick",
      description: `Подпишись на канал ${OFFICIAL_KICK_CHANNEL_SLUG} на Kick (при отписке монеты будут списаны).`,
      reward: 300,
      platform: "kick",
      type: "daily",
      validationType: "api",
      meta: {
        kick: {
          kind: "follow",
          channel_slug: OFFICIAL_KICK_CHANNEL_SLUG,
        },
        actionUrl: `https://kick.com/${OFFICIAL_KICK_CHANNEL_SLUG}`,
        actionLabel: "Открыть Kick",
        verifyLabel: "Проверить подписку",
        uiSection: "stream_tasks",
        uiOrder: 10,
        help: {
          title: "Как получить награду",
          body: `Открой kick.com/${OFFICIAL_KICK_CHANNEL_SLUG}, подпишись, затем «Проверить подписку».`,
          icon: "tv",
        },
      },
    },
  ];

  for (const t of taskSeeds) {
    const active = "active" in t && t.active === false ? false : true;
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
          active,
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
        active,
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
