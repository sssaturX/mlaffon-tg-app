import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  platformAccounts,
  referrals,
  userBalances,
  userStreaks,
  userStreamStreaks,
  users,
} from "../db/schema.js";
import { referralCode as genReferralCode } from "../lib/nanoid.js";
import type { TelegramUserPayload } from "../lib/telegram.js";
import { linkTelegramFromToken } from "./accountLink.js";
import { applyCreditSplit } from "./economy.js";
import { gameConfig } from "../config.js";

export async function findByReferralCode(code: string) {
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.referralCode, code))
    .limit(1);
  return u ?? null;
}

export async function ensureUserFromTelegram(
  tg: TelegramUserPayload,
  startParam: string | null
): Promise<{ userId: string; created: boolean; accountsMerged?: boolean }> {
  const telegramId = BigInt(tg.id);

  if (startParam?.startsWith("link_")) {
    const secret = startParam.slice(5);
    if (secret.length > 0) {
      return linkTelegramFromToken(secret, telegramId, tg);
    }
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  if (existing) {
    await db
      .update(users)
      .set({
        username: tg.username ?? null,
        firstName: tg.first_name ?? null,
        lastName: tg.last_name ?? null,
        photoUrl: tg.photo_url ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, existing.id));
    return { userId: existing.id, created: false };
  }

  let referredById: string | null = null;
  if (startParam?.startsWith("ref_")) {
    const code = startParam.slice(4);
    const refUser = await findByReferralCode(code);
    if (refUser && refUser.telegramId !== telegramId) {
      referredById = refUser.id;
    }
  }

  const code = genReferralCode();
  const [inserted] = await db
    .insert(users)
    .values({
      telegramId,
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      lastName: tg.last_name ?? null,
      photoUrl: tg.photo_url ?? null,
      referralCode: code,
      referredById,
    })
    .returning({ id: users.id });

  const userId = inserted!.id;

  await db.insert(userBalances).values({ userId, coins: 0, lifetimeEarned: 0 });
  await db.insert(userStreaks).values({ userId, currentStreak: 0 });
  await db.insert(userStreamStreaks).values({
    userId,
    twitchCurrent: 0,
    kickCurrent: 0,
  });

  if (referredById) {
    await db.insert(referrals).values({
      referrerId: referredById,
      refereeId: userId,
    });
    const idem = `referral_referee_join:${userId}`;
    await applyCreditSplit({
      userId,
      amount: gameConfig.referral.refereeBonus,
      idempotencyKey: idem,
      kind: "referral_referee",
      referenceType: "referrer",
      referenceId: referredById,
    });
  }

  return { userId, created: true };
}

/**
 * Привязка реферера по `start_param` для уже существующего пользователя
 * (первый заход был без ref, позже открыли ссылку с ref_*).
 * `start_param` доверяем только из проверенного initData на `/auth/telegram`.
 */
export async function applyReferralFromStartParam(
  userId: string,
  telegramId: bigint,
  startParam: string | null
): Promise<void> {
  if (!startParam?.startsWith("ref_")) return;
  const code = startParam.slice(4);
  if (!code) return;

  const refUser = await findByReferralCode(code);
  if (!refUser || refUser.telegramId === telegramId || refUser.id === userId) {
    return;
  }

  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u || u.referredById) return;

  const [existingRef] = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(eq(referrals.refereeId, userId))
    .limit(1);
  if (existingRef) return;

  await db
    .update(users)
    .set({ referredById: refUser.id, updatedAt: sql`now()` })
    .where(eq(users.id, userId));

  await db.insert(referrals).values({
    referrerId: refUser.id,
    refereeId: userId,
  });

  const idem = `referral_referee_join:${userId}`;
  await applyCreditSplit({
    userId,
    amount: gameConfig.referral.refereeBonus,
    idempotencyKey: idem,
    kind: "referral_referee",
    referenceType: "referrer",
    referenceId: refUser.id,
  });
}

export async function deleteUserAccount(userId: string) {
  await db.delete(users).where(eq(users.id, userId));
}
