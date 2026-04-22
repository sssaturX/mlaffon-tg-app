import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings, giveaways } from "../db/schema.js";
import { parseStoredMediaImage } from "../lib/mediaImageJson.js";
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

function mapHomeGiveawayRow(
  x: (typeof giveaways)["$inferSelect"],
  counts: Map<string, number>
) {
  return {
    id: x.id,
    title: x.title,
    prizeText: x.prizeText,
    description: x.description ?? null,
    imageUrl: x.imageUrl,
    imageMedia: parseStoredMediaImage(x.imageMedia),
    endsAt: x.endsAt.toISOString(),
    winnerCount: x.winnerCount,
    ticketPriceCoins: x.ticketPriceCoins,
    participantCount: counts.get(x.id) ?? 0,
    drawnAt: x.drawnAt ? x.drawnAt.toISOString() : null,
  };
}

export async function buildHomeGiveawaysResponse(): Promise<{
  giveaways: ReturnType<typeof mapHomeGiveawayRow>[];
  completedGiveaways: ReturnType<typeof mapHomeGiveawayRow>[];
}> {
  const g = await db
    .select()
    .from(giveaways)
    .where(and(eq(giveaways.active, true), isNull(giveaways.drawnAt)))
    .orderBy(desc(giveaways.sortOrder), desc(giveaways.endsAt))
    .limit(10);

  const completedRows = await db
    .select()
    .from(giveaways)
    .where(isNotNull(giveaways.drawnAt))
    .orderBy(desc(giveaways.drawnAt))
    .limit(8);

  const ids = [...g.map((x) => x.id), ...completedRows.map((x) => x.id)];
  const uniqIds = [...new Set(ids)];
  const counts = await getParticipantCountsForGiveawayIds(uniqIds);

  return {
    giveaways: g.map((x) => mapHomeGiveawayRow(x, counts)),
    completedGiveaways: completedRows.map((x) => mapHomeGiveawayRow(x, counts)),
  };
}

export async function buildHomePublicResponse(): Promise<{
  giveaways: Awaited<ReturnType<typeof buildHomeGiveawaysResponse>>["giveaways"];
  completedGiveaways: Awaited<ReturnType<typeof buildHomeGiveawaysResponse>>["completedGiveaways"];
  faq: { q: string; a: string }[];
}> {
  const [content, homeGw] = await Promise.all([
    buildHomeContentResponse(),
    buildHomeGiveawaysResponse(),
  ]);
  return {
    ...content,
    giveaways: homeGw.giveaways,
    completedGiveaways: homeGw.completedGiveaways,
  };
}
