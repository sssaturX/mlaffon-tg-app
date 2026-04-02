import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import {
  userBalances,
  userStreaks,
  userStreamStreaks,
  users,
} from "../db/schema.js";
import { referralCode as genReferralCode } from "../lib/nanoid.js";
import { signSession } from "../lib/jwt.js";

const SALT_ROUNDS = 11;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registerWithEmail(
  emailRaw: string,
  password: string
): Promise<
  | { ok: true; token: string; userId: string }
  | { ok: false; code: "email_taken" | "weak_password" }
> {
  if (password.length < 8) {
    return { ok: false, code: "weak_password" };
  }
  const email = normalizeEmail(emailRaw);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const code = genReferralCode();
  const localPart = email.split("@")[0] ?? "player";

  try {
    const [ins] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        telegramId: null,
        username: localPart.slice(0, 32),
        firstName: localPart.slice(0, 64),
        referralCode: code,
      })
      .returning({ id: users.id });

    const userId = ins!.id;
    await db.insert(userBalances).values({ userId, coins: 0, lifetimeEarned: 0 });
    await db.insert(userStreaks).values({ userId, currentStreak: 0 });
    await db.insert(userStreamStreaks).values({
      userId,
      twitchCurrent: 0,
      kickCurrent: 0,
    });

    const token = signSession(userId, null);
    return { ok: true, token, userId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique|duplicate/i.test(msg)) {
      return { ok: false, code: "email_taken" };
    }
    throw e;
  }
}

export async function loginWithEmail(
  emailRaw: string,
  password: string
): Promise<
  | { ok: true; token: string; userId: string }
  | { ok: false; code: "invalid_credentials" }
> {
  const email = normalizeEmail(emailRaw);
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!u?.passwordHash) {
    return { ok: false, code: "invalid_credentials" };
  }
  const match = await bcrypt.compare(password, u.passwordHash);
  if (!match) {
    return { ok: false, code: "invalid_credentials" };
  }
  const token = signSession(u.id, u.telegramId);
  return { ok: true, token, userId: u.id };
}

/**
 * Пользователь зашёл через Telegram — добавляем email/пароль для входа с сайта (тот же user_id).
 */
export async function attachEmailPasswordToUser(
  userId: string,
  emailRaw: string,
  password: string
): Promise<
  | { ok: true }
  | {
      ok: false;
      code: "email_taken" | "weak_password" | "already_has_credentials";
    }
> {
  if (password.length < 8) {
    return { ok: false, code: "weak_password" };
  }
  const email = normalizeEmail(emailRaw);

  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) {
    return { ok: false, code: "already_has_credentials" };
  }
  if (u.passwordHash) {
    return { ok: false, code: "already_has_credentials" };
  }

  const [dup] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (dup && dup.id !== userId) {
    return { ok: false, code: "email_taken" };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  try {
    await db
      .update(users)
      .set({
        email,
        passwordHash,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId));
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique|duplicate/i.test(msg)) {
      return { ok: false, code: "email_taken" };
    }
    throw e;
  }
}
