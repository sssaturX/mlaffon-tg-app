import { eq, sql, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  appSettings,
  giveaways,
  userBalances,
  users,
} from "../db/schema.js";
import { getParticipantCountsForGiveawayIds } from "./giveaways.js";

export type CashbackPublic = {
  enabled: boolean;
  title: string;
  imageUrl: string | null;
  body: string;
};

const defaultCashback: CashbackPublic = {
  enabled: true,
  title: "Кэшбек Mlaffon",
  imageUrl: null,
  body: "Копите монеты на Twitch и Kick и обменивайте в магазине.",
};

export async function getCashbackSetting(): Promise<CashbackPublic> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "cashback"))
    .limit(1);
  if (!row?.value) return defaultCashback;
  const v = row.value as Partial<CashbackPublic>;
  return { ...defaultCashback, ...v };
}

export async function getFaqItems(): Promise<{ q: string; a: string }[]> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "faq"))
    .limit(1);
  if (!row?.value) {
    return [
      {
        q: "Как заработать монеты?",
        a: "Выполняйте задания, стрики на стримах и участвуйте в акциях.",
      },
      {
        q: "Twitch и Kick — это разные балансы?",
        a: "Да, в шапке можно переключить платформу. Реферальные проценты начисляются раз в неделю после подключения OAuth.",
      },
    ];
  }
  const arr = row.value as { items?: { q: string; a: string }[] };
  return Array.isArray(arr.items) ? arr.items : [];
}

export async function buildHomePublicResponse(): Promise<{
  stats: { usersCount: number; coinsEarnedTotal: number };
  giveaways: {
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
  }[];
  cashback: CashbackPublic;
  faq: { q: string; a: string }[];
}> {
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users);
  const [{ s }] = await db
    .select({
      s: sql<number>`coalesce(sum(${userBalances.lifetimeEarned}), 0)::int`,
    })
    .from(userBalances);

  const g = await db
    .select()
    .from(giveaways)
    .where(eq(giveaways.active, true))
    .orderBy(desc(giveaways.sortOrder), desc(giveaways.endsAt))
    .limit(10);

  const counts = await getParticipantCountsForGiveawayIds(g.map((x) => x.id));

  return {
    stats: { usersCount: c ?? 0, coinsEarnedTotal: s ?? 0 },
    giveaways: g.map((x) => ({
      id: x.id,
      title: x.title,
      prizeText: x.prizeText,
      description: x.description ?? null,
      imageUrl: x.imageUrl,
      endsAt: x.endsAt.toISOString(),
      winnerCount: x.winnerCount,
      ticketPriceCoins: x.ticketPriceCoins,
      participantCount: counts.get(x.id) ?? 0,
      drawnAt: x.drawnAt ? x.drawnAt.toISOString() : null,
    })),
    cashback: await getCashbackSetting(),
    faq: await getFaqItems(),
  };
}
