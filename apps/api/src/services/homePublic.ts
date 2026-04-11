import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings, giveaways } from "../db/schema.js";
import { getParticipantCountsForGiveawayIds } from "./giveaways.js";
import { DEFAULT_FAQ_ITEMS } from "../content/faqDefault.js";

export async function getFaqItems(): Promise<{ q: string; a: string }[]> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "faq"))
    .limit(1);
  if (!row?.value) {
    return DEFAULT_FAQ_ITEMS;
  }
  const arr = row.value as { items?: { q: string; a: string }[] };
  return Array.isArray(arr.items) ? arr.items : [];
}

export async function buildHomeContentResponse(): Promise<{
  faq: { q: string; a: string }[];
}> {
  const faq = await getFaqItems();
  return { faq };
}

export async function buildHomeGiveawaysResponse(): Promise<{
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
}> {
  const g = await db
    .select()
    .from(giveaways)
    .where(and(eq(giveaways.active, true), isNull(giveaways.drawnAt)))
    .orderBy(desc(giveaways.sortOrder), desc(giveaways.endsAt))
    .limit(10);

  const counts = await getParticipantCountsForGiveawayIds(g.map((x) => x.id));

  return {
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
  };
}

export async function buildHomePublicResponse(): Promise<{
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
  faq: { q: string; a: string }[];
}> {
  const [content, { giveaways }] = await Promise.all([
    buildHomeContentResponse(),
    buildHomeGiveawaysResponse(),
  ]);
  return { ...content, giveaways };
}
