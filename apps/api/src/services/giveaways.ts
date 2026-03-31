import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  giveawayParticipants,
  giveawayWinners,
  giveaways,
  users,
} from "../db/schema.js";
import { applyDebit } from "./economy.js";
import { checkTelegramChannelMembership } from "./telegramChannel.js";

export function displayUsername(u: {
  username: string | null;
  firstName: string | null;
  telegramId: bigint;
}): string {
  if (u.username) return `@${u.username}`;
  if (u.firstName) return u.firstName;
  return `tg:${u.telegramId}`;
}

export async function getGiveawayParticipantCount(giveawayId: string): Promise<number> {
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(giveawayParticipants)
    .where(eq(giveawayParticipants.giveawayId, giveawayId));
  return c ?? 0;
}

export async function getParticipantCountsForGiveawayIds(
  ids: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      giveawayId: giveawayParticipants.giveawayId,
      c: sql<number>`count(*)::int`,
    })
    .from(giveawayParticipants)
    .where(inArray(giveawayParticipants.giveawayId, ids))
    .groupBy(giveawayParticipants.giveawayId);
  for (const r of rows) map.set(r.giveawayId, r.c ?? 0);
  return map;
}

export type GiveawayPublicDetail = {
  id: string;
  title: string;
  prizeText: string;
  description: string | null;
  imageUrl: string | null;
  endsAt: string;
  active: boolean;
  winnerCount: number;
  ticketPriceCoins: number;
  participantCount: number;
  drawnAt: string | null;
  winners: { rank: number; username: string }[];
  isParticipant: boolean;
  joinedAt: string | null;
  /** Условие: подписка на канал (ссылку показываем из channelInviteUrl). */
  requireChannelSubscription: boolean;
  channelInviteUrl: string | null;
  /** null — условия нет или пользователь не авторизован; иначе результат проверки getChatMember. */
  channelSubscriptionOk: boolean | null;
};

export async function getGiveawayPublicDetail(
  giveawayId: string,
  userId: string | null
): Promise<GiveawayPublicDetail | null> {
  const [g] = await db
    .select()
    .from(giveaways)
    .where(eq(giveaways.id, giveawayId))
    .limit(1);
  if (!g) return null;

  const participantCount = await getGiveawayParticipantCount(giveawayId);

  const winRows = await db
    .select({
      rank: giveawayWinners.rank,
      username: users.username,
      firstName: users.firstName,
      telegramId: users.telegramId,
    })
    .from(giveawayWinners)
    .innerJoin(users, eq(giveawayWinners.userId, users.id))
    .where(eq(giveawayWinners.giveawayId, giveawayId))
    .orderBy(asc(giveawayWinners.rank));

  let isParticipant = false;
  let joinedAt: string | null = null;
  let channelSubscriptionOk: boolean | null = null;
  if (g.requireChannelSubscription && g.telegramChannelId?.trim()) {
    if (userId) {
      const [u] = await db
        .select({ telegramId: users.telegramId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (u) {
        channelSubscriptionOk = await checkTelegramChannelMembership(
          u.telegramId,
          g.telegramChannelId
        );
      }
    }
  }

  if (userId) {
    const [p] = await db
      .select({ createdAt: giveawayParticipants.createdAt })
      .from(giveawayParticipants)
      .where(
        and(
          eq(giveawayParticipants.giveawayId, giveawayId),
          eq(giveawayParticipants.userId, userId)
        )
      )
      .limit(1);
    if (p) {
      isParticipant = true;
      joinedAt = p.createdAt.toISOString();
    }
  }

  return {
    id: g.id,
    title: g.title,
    prizeText: g.prizeText,
    description: g.description ?? null,
    imageUrl: g.imageUrl,
    endsAt: g.endsAt.toISOString(),
    active: g.active,
    winnerCount: g.winnerCount,
    ticketPriceCoins: g.ticketPriceCoins,
    participantCount,
    drawnAt: g.drawnAt ? g.drawnAt.toISOString() : null,
    winners: winRows.map((w) => ({
      rank: w.rank,
      username: displayUsername({
        username: w.username,
        firstName: w.firstName,
        telegramId: w.telegramId,
      }),
    })),
    isParticipant,
    joinedAt,
    requireChannelSubscription: g.requireChannelSubscription,
    channelInviteUrl: g.channelInviteUrl ?? null,
    channelSubscriptionOk,
  };
}

export async function joinGiveaway(params: {
  giveawayId: string;
  userId: string;
  platform: "twitch" | "kick";
}): Promise<
  | { ok: true; joinedAt: string }
  | {
      ok: false;
      code:
        | "not_found"
        | "inactive"
        | "ended"
        | "already_drawn"
        | "already_joined"
        | "insufficient_coins"
        | "duplicate_debit"
        | "channel_not_subscribed"
        | "channel_not_configured";
    }
> {
  const { giveawayId, userId, platform } = params;

  const [g] = await db
    .select()
    .from(giveaways)
    .where(eq(giveaways.id, giveawayId))
    .limit(1);
  if (!g) return { ok: false, code: "not_found" };
  if (!g.active) return { ok: false, code: "inactive" };
  if (g.drawnAt) return { ok: false, code: "already_drawn" };
  const now = new Date();
  if (g.endsAt <= now) return { ok: false, code: "ended" };

  if (g.requireChannelSubscription) {
    const ch = g.telegramChannelId?.trim();
    if (!ch) return { ok: false, code: "channel_not_configured" };
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return { ok: false, code: "channel_not_configured" };
    const [u] = await db
      .select({ telegramId: users.telegramId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return { ok: false, code: "not_found" };
    const okMember = await checkTelegramChannelMembership(u.telegramId, ch);
    if (!okMember) return { ok: false, code: "channel_not_subscribed" };
  }

  const [existing] = await db
    .select({ id: giveawayParticipants.id })
    .from(giveawayParticipants)
    .where(
      and(
        eq(giveawayParticipants.giveawayId, giveawayId),
        eq(giveawayParticipants.userId, userId)
      )
    )
    .limit(1);
  if (existing) return { ok: false, code: "already_joined" };

  const price = g.ticketPriceCoins;
  if (price > 0) {
    const debit = await applyDebit({
      userId,
      amount: price,
      idempotencyKey: `giveaway_ticket:${giveawayId}:${userId}`,
      kind: "giveaway_ticket",
      platform,
      referenceType: "giveaway",
      referenceId: giveawayId,
    });
    if (!debit.ok) {
      return {
        ok: false,
        code: debit.reason === "duplicate" ? "duplicate_debit" : "insufficient_coins",
      };
    }
  }

  const [ins] = await db
    .insert(giveawayParticipants)
    .values({ giveawayId, userId })
    .returning({ createdAt: giveawayParticipants.createdAt });

  return { ok: true, joinedAt: ins!.createdAt.toISOString() };
}

function shuffleUserIds(ids: string[]): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function drawGiveawayWinners(giveawayId: string): Promise<
  | {
      ok: true;
      winners: { rank: number; userId: string; username: string }[];
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "already_drawn"
        | "not_enough_participants"
        | "zero_winners";
    }
> {
  const [g] = await db
    .select()
    .from(giveaways)
    .where(eq(giveaways.id, giveawayId))
    .limit(1);
  if (!g) return { ok: false, code: "not_found" };
  if (g.drawnAt) return { ok: false, code: "already_drawn" };
  const need = g.winnerCount;
  if (need <= 0) return { ok: false, code: "zero_winners" };

  const parts = await db
    .select({ userId: giveawayParticipants.userId })
    .from(giveawayParticipants)
    .where(eq(giveawayParticipants.giveawayId, giveawayId));
  if (parts.length < need)
    return { ok: false, code: "not_enough_participants" };

  const picked = shuffleUserIds(parts.map((p) => p.userId)).slice(0, need);

  const drawnAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(giveaways)
      .set({ drawnAt })
      .where(eq(giveaways.id, giveawayId));

    for (let i = 0; i < picked.length; i++) {
      await tx.insert(giveawayWinners).values({
        giveawayId,
        userId: picked[i]!,
        rank: i + 1,
      });
    }
  });

  const userRows = await db
    .select({
      id: users.id,
      username: users.username,
      firstName: users.firstName,
      telegramId: users.telegramId,
    })
    .from(users)
    .where(inArray(users.id, picked));

  const byId = new Map(userRows.map((u) => [u.id, u]));
  const winners = picked.map((uid, idx) => {
    const u = byId.get(uid)!;
    return {
      rank: idx + 1,
      userId: uid,
      username: displayUsername({
        username: u.username,
        firstName: u.firstName,
        telegramId: u.telegramId,
      }),
    };
  });

  return { ok: true, winners };
}

export type GiveawayListItem = {
  id: string;
  title: string;
  prizeText: string;
  imageUrl: string | null;
  endsAt: string;
  winnerCount: number;
  ticketPriceCoins: number;
  participantCount: number;
  drawnAt: string | null;
  active: boolean;
  status: "live" | "ended_awaiting_draw" | "completed";
};

export async function listGiveawaysPublic(): Promise<GiveawayListItem[]> {
  const rows = await db
    .select()
    .from(giveaways)
    .where(or(eq(giveaways.active, true), isNotNull(giveaways.drawnAt)))
    .orderBy(desc(giveaways.sortOrder), desc(giveaways.endsAt));

  const counts = await getParticipantCountsForGiveawayIds(rows.map((r) => r.id));
  const now = Date.now();
  return rows.map((g) => {
    const drawnAt = g.drawnAt ? g.drawnAt.toISOString() : null;
    let status: GiveawayListItem["status"];
    if (g.drawnAt) status = "completed";
    else if (g.endsAt.getTime() <= now) status = "ended_awaiting_draw";
    else status = "live";
    return {
      id: g.id,
      title: g.title,
      prizeText: g.prizeText,
      imageUrl: g.imageUrl,
      endsAt: g.endsAt.toISOString(),
      winnerCount: g.winnerCount,
      ticketPriceCoins: g.ticketPriceCoins,
      participantCount: counts.get(g.id) ?? 0,
      drawnAt,
      active: g.active,
      status,
    };
  });
}

export async function listGiveawayParticipantsWithUsernames(giveawayId: string): Promise<
  { userId: string; username: string; joinedAt: string }[]
> {
  const rows = await db
    .select({
      userId: giveawayParticipants.userId,
      joinedAt: giveawayParticipants.createdAt,
      username: users.username,
      firstName: users.firstName,
      telegramId: users.telegramId,
    })
    .from(giveawayParticipants)
    .innerJoin(users, eq(giveawayParticipants.userId, users.id))
    .where(eq(giveawayParticipants.giveawayId, giveawayId))
    .orderBy(giveawayParticipants.createdAt);

  return rows.map((r) => ({
    userId: r.userId,
    username: displayUsername({
      username: r.username,
      firstName: r.firstName,
      telegramId: r.telegramId,
    }),
    joinedAt: r.joinedAt.toISOString(),
  }));
}
