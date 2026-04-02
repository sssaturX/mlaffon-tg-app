import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  banAppeals,
  dropUserStates,
  fortuneSpins,
  giveawayParticipants,
  giveawayWinners,
  liveBroadcastViews,
  platformAccounts,
  promoRedemptions,
  referrals,
  transactions,
  userBalances,
  userInventory,
  userStreaks,
  userStreamStreaks,
  userTasks,
  users,
} from "../db/schema.js";

type UserRow = typeof users.$inferSelect;
export type BalRow = typeof userBalances.$inferSelect;
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function zeroBalance(userId: string): BalRow {
  return {
    userId,
    coins: 0,
    lifetimeEarned: 0,
    twitchCoins: 0,
    kickCoins: 0,
    twitchLifetimeEarned: 0,
    kickLifetimeEarned: 0,
  };
}

/** Суммарный «прогресс» для выбора основного аккаунта при слиянии. */
function scoreBalance(b: BalRow): number {
  return (
    (b.twitchLifetimeEarned ?? 0) +
    (b.kickLifetimeEarned ?? 0)
  );
}

function coinsTotal(b: BalRow): number {
  return (b.twitchCoins ?? 0) + (b.kickCoins ?? 0);
}

/**
 * Кто остаётся: больше lifetime (Twitch+Kick), иначе больше монет на счетах, иначе более ранняя регистрация.
 */
export function pickSurvivorByProgress(
  a: UserRow,
  b: UserRow,
  balA: BalRow,
  balB: BalRow
): { survivorId: string; loserId: string } {
  const sA = scoreBalance(balA);
  const sB = scoreBalance(balB);
  if (sA !== sB) {
    return sA > sB
      ? { survivorId: a.id, loserId: b.id }
      : { survivorId: b.id, loserId: a.id };
  }
  const cA = coinsTotal(balA);
  const cB = coinsTotal(balB);
  if (cA !== cB) {
    return cA > cB
      ? { survivorId: a.id, loserId: b.id }
      : { survivorId: b.id, loserId: a.id };
  }
  const tA = a.createdAt.getTime();
  const tB = b.createdAt.getTime();
  return tA <= tB
    ? { survivorId: a.id, loserId: b.id }
    : { survivorId: b.id, loserId: a.id };
}

function taskKey(taskId: string, periodKey: string | null): string {
  return `${taskId}\0${periodKey ?? ""}`;
}

/**
 * Переносит данные с loser на survivor и удаляет loser. Предполагается разный user_id.
 * Telegram и профиль TG выставляет вызывающий (например linkTelegramFromToken).
 */
export async function mergeUserIntoSurvivorTx(
  tx: DbTx,
  survivorId: string,
  loserId: string
): Promise<void> {
  if (survivorId === loserId) return;

  const [sRow] = await tx
    .select()
    .from(users)
    .where(eq(users.id, survivorId))
    .limit(1);
  const [lRow] = await tx
    .select()
    .from(users)
    .where(eq(users.id, loserId))
    .limit(1);
  if (!sRow || !lRow) throw new Error("merge: user not found");

  const [sBal] = await tx
    .select()
    .from(userBalances)
    .where(eq(userBalances.userId, survivorId))
    .limit(1);
  const [lBal] = await tx
    .select()
    .from(userBalances)
    .where(eq(userBalances.userId, loserId))
    .limit(1);

  if (sBal && lBal) {
    await tx
      .update(userBalances)
      .set({
        coins: sql`${userBalances.coins} + ${lBal.coins}`,
        lifetimeEarned: sql`${userBalances.lifetimeEarned} + ${lBal.lifetimeEarned}`,
        twitchCoins: sql`${userBalances.twitchCoins} + ${lBal.twitchCoins}`,
        kickCoins: sql`${userBalances.kickCoins} + ${lBal.kickCoins}`,
        twitchLifetimeEarned: sql`${userBalances.twitchLifetimeEarned} + ${lBal.twitchLifetimeEarned}`,
        kickLifetimeEarned: sql`${userBalances.kickLifetimeEarned} + ${lBal.kickLifetimeEarned}`,
      })
      .where(eq(userBalances.userId, survivorId));
  }

  const [sSt] = await tx
    .select()
    .from(userStreaks)
    .where(eq(userStreaks.userId, survivorId))
    .limit(1);
  const [lSt] = await tx
    .select()
    .from(userStreaks)
    .where(eq(userStreaks.userId, loserId))
    .limit(1);
  if (sSt && lSt) {
    const maxStreak = Math.max(sSt.currentStreak, lSt.currentStreak);
    let lastDate: string | null = sSt.lastActivityUtcDate ?? null;
    const ld = lSt.lastActivityUtcDate;
    if (ld && (!lastDate || ld > lastDate)) lastDate = ld;
    await tx
      .update(userStreaks)
      .set({
        currentStreak: maxStreak,
        lastActivityUtcDate: lastDate,
      })
      .where(eq(userStreaks.userId, survivorId));
  }

  const [sSs] = await tx
    .select()
    .from(userStreamStreaks)
    .where(eq(userStreamStreaks.userId, survivorId))
    .limit(1);
  const [lSs] = await tx
    .select()
    .from(userStreamStreaks)
    .where(eq(userStreamStreaks.userId, loserId))
    .limit(1);
  if (sSs && lSs) {
    const tw = Math.max(sSs.twitchCurrent, lSs.twitchCurrent);
    const ki = Math.max(sSs.kickCurrent, lSs.kickCurrent);
    let twD = sSs.twitchLastUtcDate ?? null;
    const twL = lSs.twitchLastUtcDate;
    if (twL && (!twD || twL > twD)) twD = twL;
    let kiD = sSs.kickLastUtcDate ?? null;
    const kiL = lSs.kickLastUtcDate;
    if (kiL && (!kiD || kiL > kiD)) kiD = kiL;
    await tx
      .update(userStreamStreaks)
      .set({
        twitchCurrent: tw,
        kickCurrent: ki,
        twitchLastUtcDate: twD,
        kickLastUtcDate: kiD,
      })
      .where(eq(userStreamStreaks.userId, survivorId));
  }

  const survTaskKeys = new Set<string>();
  const survTasks = await tx
    .select({
      taskId: userTasks.taskId,
      periodKey: userTasks.periodKey,
    })
    .from(userTasks)
    .where(eq(userTasks.userId, survivorId));
  for (const r of survTasks) {
    survTaskKeys.add(taskKey(r.taskId, r.periodKey));
  }
  const losTasks = await tx
    .select()
    .from(userTasks)
    .where(eq(userTasks.userId, loserId));
  for (const t of losTasks) {
    if (survTaskKeys.has(taskKey(t.taskId, t.periodKey))) {
      await tx.delete(userTasks).where(eq(userTasks.id, t.id));
    } else {
      await tx
        .update(userTasks)
        .set({ userId: survivorId })
        .where(eq(userTasks.id, t.id));
    }
  }

  const survTxKeys = new Set(
    (
      await tx
        .select({ k: transactions.idempotencyKey })
        .from(transactions)
        .where(eq(transactions.userId, survivorId))
    ).map((r) => r.k)
  );
  const losTx = await tx
    .select()
    .from(transactions)
    .where(eq(transactions.userId, loserId));
  for (const row of losTx) {
    if (survTxKeys.has(row.idempotencyKey)) {
      await tx.delete(transactions).where(eq(transactions.id, row.id));
    } else {
      await tx
        .update(transactions)
        .set({ userId: survivorId })
        .where(eq(transactions.id, row.id));
    }
  }

  const survPlat = new Set(
    (
      await tx
        .select({ platform: platformAccounts.platform })
        .from(platformAccounts)
        .where(eq(platformAccounts.userId, survivorId))
    ).map((r) => r.platform)
  );
  const losPa = await tx
    .select()
    .from(platformAccounts)
    .where(eq(platformAccounts.userId, loserId));
  for (const row of losPa) {
    if (survPlat.has(row.platform)) {
      await tx.delete(platformAccounts).where(eq(platformAccounts.id, row.id));
    } else {
      await tx
        .update(platformAccounts)
        .set({ userId: survivorId })
        .where(eq(platformAccounts.id, row.id));
    }
  }

  const survLb = new Set(
    (
      await tx
        .select({ broadcastId: liveBroadcastViews.broadcastId })
        .from(liveBroadcastViews)
        .where(eq(liveBroadcastViews.userId, survivorId))
    ).map((r) => r.broadcastId)
  );
  const losLb = await tx
    .select()
    .from(liveBroadcastViews)
    .where(eq(liveBroadcastViews.userId, loserId));
  for (const row of losLb) {
    if (survLb.has(row.broadcastId)) {
      await tx
        .delete(liveBroadcastViews)
        .where(eq(liveBroadcastViews.id, row.id));
    } else {
      await tx
        .update(liveBroadcastViews)
        .set({ userId: survivorId })
        .where(eq(liveBroadcastViews.id, row.id));
    }
  }

  await tx
    .update(referrals)
    .set({ referrerId: survivorId })
    .where(eq(referrals.referrerId, loserId));

  const [survRef] = await tx
    .select()
    .from(referrals)
    .where(eq(referrals.refereeId, survivorId))
    .limit(1);
  const [losRef] = await tx
    .select()
    .from(referrals)
    .where(eq(referrals.refereeId, loserId))
    .limit(1);
  if (losRef) {
    if (survRef) {
      await tx.delete(referrals).where(eq(referrals.id, losRef.id));
    } else {
      await tx
        .update(referrals)
        .set({ refereeId: survivorId })
        .where(eq(referrals.id, losRef.id));
    }
  }

  const survGw = new Set(
    (
      await tx
        .select({ giveawayId: giveawayParticipants.giveawayId })
        .from(giveawayParticipants)
        .where(eq(giveawayParticipants.userId, survivorId))
    ).map((r) => r.giveawayId)
  );
  const losGp = await tx
    .select()
    .from(giveawayParticipants)
    .where(eq(giveawayParticipants.userId, loserId));
  for (const row of losGp) {
    if (survGw.has(row.giveawayId)) {
      await tx
        .delete(giveawayParticipants)
        .where(eq(giveawayParticipants.id, row.id));
    } else {
      await tx
        .update(giveawayParticipants)
        .set({ userId: survivorId })
        .where(eq(giveawayParticipants.id, row.id));
    }
  }

  const survWin = new Set(
    (
      await tx
        .select({ giveawayId: giveawayWinners.giveawayId })
        .from(giveawayWinners)
        .where(eq(giveawayWinners.userId, survivorId))
    ).map((r) => r.giveawayId)
  );
  const losGw = await tx
    .select()
    .from(giveawayWinners)
    .where(eq(giveawayWinners.userId, loserId));
  for (const row of losGw) {
    if (survWin.has(row.giveawayId)) {
      await tx
        .delete(giveawayWinners)
        .where(eq(giveawayWinners.id, row.id));
    } else {
      await tx
        .update(giveawayWinners)
        .set({ userId: survivorId })
        .where(eq(giveawayWinners.id, row.id));
    }
  }

  const survPromo = new Set(
    (
      await tx
        .select({ promoId: promoRedemptions.promoId })
        .from(promoRedemptions)
        .where(eq(promoRedemptions.userId, survivorId))
    ).map((r) => r.promoId)
  );
  const losPr = await tx
    .select()
    .from(promoRedemptions)
    .where(eq(promoRedemptions.userId, loserId));
  for (const row of losPr) {
    if (survPromo.has(row.promoId)) {
      await tx
        .delete(promoRedemptions)
        .where(eq(promoRedemptions.id, row.id));
    } else {
      await tx
        .update(promoRedemptions)
        .set({ userId: survivorId })
        .where(eq(promoRedemptions.id, row.id));
    }
  }

  const survDrop = new Set(
    (
      await tx
        .select({ dropId: dropUserStates.dropId })
        .from(dropUserStates)
        .where(eq(dropUserStates.userId, survivorId))
    ).map((r) => r.dropId)
  );
  const losDs = await tx
    .select()
    .from(dropUserStates)
    .where(eq(dropUserStates.userId, loserId));
  for (const row of losDs) {
    if (survDrop.has(row.dropId)) {
      const [ex] = await tx
        .select()
        .from(dropUserStates)
        .where(
          and(
            eq(dropUserStates.userId, survivorId),
            eq(dropUserStates.dropId, row.dropId)
          )
        )
        .limit(1);
      if (ex) {
        await tx
          .update(dropUserStates)
          .set({
            attemptsCount: sql`GREATEST(${dropUserStates.attemptsCount}, ${row.attemptsCount})`,
            won: sql`${dropUserStates.won} OR ${row.won}`,
            rewardCoins: sql`COALESCE(${dropUserStates.rewardCoins}, ${row.rewardCoins})`,
            lastAttemptAt: sql`CASE
              WHEN ${dropUserStates.lastAttemptAt} IS NULL THEN ${row.lastAttemptAt}
              WHEN ${row.lastAttemptAt} IS NULL THEN ${dropUserStates.lastAttemptAt}
              WHEN ${dropUserStates.lastAttemptAt} > ${row.lastAttemptAt} THEN ${dropUserStates.lastAttemptAt}
              ELSE ${row.lastAttemptAt}
            END`,
          })
          .where(eq(dropUserStates.id, ex.id));
      }
      await tx.delete(dropUserStates).where(eq(dropUserStates.id, row.id));
    } else {
      await tx
        .update(dropUserStates)
        .set({ userId: survivorId })
        .where(eq(dropUserStates.id, row.id));
    }
  }

  const losInv = await tx
    .select()
    .from(userInventory)
    .where(eq(userInventory.userId, loserId));
  for (const row of losInv) {
    const [ex] = await tx
      .select()
      .from(userInventory)
      .where(
        and(
          eq(userInventory.userId, survivorId),
          eq(userInventory.itemId, row.itemId)
        )
      )
      .limit(1);
    if (ex) {
      await tx
        .update(userInventory)
        .set({
          quantity: sql`${userInventory.quantity} + ${row.quantity}`,
          updatedAt: sql`now()`,
        })
        .where(eq(userInventory.id, ex.id));
      await tx.delete(userInventory).where(eq(userInventory.id, row.id));
    } else {
      await tx
        .update(userInventory)
        .set({ userId: survivorId })
        .where(eq(userInventory.id, row.id));
    }
  }

  const losFs = await tx
    .select()
    .from(fortuneSpins)
    .where(eq(fortuneSpins.userId, loserId));
  for (const row of losFs) {
    const [ex] = await tx
      .select()
      .from(fortuneSpins)
      .where(
        and(
          eq(fortuneSpins.userId, survivorId),
          eq(fortuneSpins.utcDate, row.utcDate)
        )
      )
      .limit(1);
    if (ex) {
      await tx
        .update(fortuneSpins)
        .set({
          freeUsed: sql`${fortuneSpins.freeUsed} OR ${row.freeUsed}`,
          paidCount: sql`${fortuneSpins.paidCount} + ${row.paidCount}`,
          updatedAt: sql`now()`,
        })
        .where(eq(fortuneSpins.id, ex.id));
      await tx.delete(fortuneSpins).where(eq(fortuneSpins.id, row.id));
    } else {
      await tx
        .update(fortuneSpins)
        .set({ userId: survivorId })
        .where(eq(fortuneSpins.id, row.id));
    }
  }

  await tx
    .update(banAppeals)
    .set({ userId: survivorId })
    .where(eq(banAppeals.userId, loserId));

  await tx
    .update(users)
    .set({ referredById: survivorId, updatedAt: sql`now()` })
    .where(
      and(eq(users.referredById, loserId), sql`${users.id} <> ${survivorId}`)
    );

  const mergedEmail = sRow.email ?? lRow.email;
  const mergedPassword = sRow.passwordHash ?? lRow.passwordHash;
  let mergedReferredBy = sRow.referredById ?? lRow.referredById;
  if (sRow.referredById === loserId) {
    mergedReferredBy = lRow.referredById ?? null;
  } else if (lRow.referredById === survivorId) {
    mergedReferredBy = sRow.referredById ?? null;
  }
  const mergedBanned = sRow.banned || lRow.banned;
  const mergedBanReason = sRow.banReason ?? lRow.banReason;

  await tx
    .update(users)
    .set({
      email: mergedEmail,
      passwordHash: mergedPassword,
      referredById: mergedReferredBy,
      banned: mergedBanned,
      banReason: mergedBanReason,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, survivorId));

  await tx.delete(users).where(eq(users.id, loserId));
}

export async function mergeUserIntoSurvivor(
  survivorId: string,
  loserId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await mergeUserIntoSurvivorTx(tx, survivorId, loserId);
  });
}
