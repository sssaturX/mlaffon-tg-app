import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userStreamStreaks } from "../db/schema.js";
import { gameConfig } from "../config.js";
import { applyCredit } from "./economy.js";
import { utcDateString } from "./streak.js";

function addDays(isoDate: string, days: number): string {
  const [y, m, day] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export async function ensureStreamStreakRow(
  userId: string
): Promise<{
  twitch: number;
  kick: number;
  twitchLast: string | null;
  kickLast: string | null;
}> {
  const [row] = await db
    .select()
    .from(userStreamStreaks)
    .where(eq(userStreamStreaks.userId, userId))
    .limit(1);

  if (!row) {
    await db.insert(userStreamStreaks).values({
      userId,
      twitchCurrent: 0,
      kickCurrent: 0,
    });
    return { twitch: 0, kick: 0, twitchLast: null, kickLast: null };
  }

  return {
    twitch: row.twitchCurrent,
    kick: row.kickCurrent,
    twitchLast: row.twitchLastUtcDate ?? null,
    kickLast: row.kickLastUtcDate ?? null,
  };
}

async function maybeStreamStreakBonus(
  userId: string,
  platform: "twitch" | "kick",
  newStreak: number
): Promise<void> {
  const { bonusEveryDays, bonusCoins } = gameConfig.streak;
  if (bonusEveryDays <= 0 || newStreak <= 0 || newStreak % bonusEveryDays !== 0) {
    return;
  }
  const idem = `stream_streak_bonus:${platform}:${userId}:${newStreak}`;
  await applyCredit({
    userId,
    amount: bonusCoins,
    idempotencyKey: idem,
    kind: "streak_bonus",
    platform,
    referenceType: "stream_streak",
    referenceId: `${platform}:${newStreak}`,
  });
}

/**
 * +1 день стрика по платформе (UTC), если сегодня ещё не засчитывали.
 * Используется при нажатии «Смотреть стрим» во время эфира, заданного в админке.
 */
export async function applyStreamStreakDay(
  userId: string,
  platform: "twitch" | "kick"
): Promise<
  | { ok: true; streak: number; utcDate: string }
  | { ok: false; code: "already_today" }
> {
  const today = utcDateString();
  const row = await ensureStreamStreakRow(userId);

  if (platform === "twitch") {
    if (row.twitchLast === today) {
      return { ok: false, code: "already_today" };
    }

    let newStreak: number;
    if (!row.twitchLast) {
      newStreak = 1;
    } else if (row.twitchLast === addDays(today, -1)) {
      newStreak = row.twitch + 1;
    } else {
      newStreak = 1;
    }

    await db
      .update(userStreamStreaks)
      .set({
        twitchCurrent: newStreak,
        twitchLastUtcDate: today,
      })
      .where(eq(userStreamStreaks.userId, userId));

    await maybeStreamStreakBonus(userId, "twitch", newStreak);
    return { ok: true, streak: newStreak, utcDate: today };
  }

  if (row.kickLast === today) {
    return { ok: false, code: "already_today" };
  }

  let newStreak: number;
  if (!row.kickLast) {
    newStreak = 1;
  } else if (row.kickLast === addDays(today, -1)) {
    newStreak = row.kick + 1;
  } else {
    newStreak = 1;
  }

  await db
    .update(userStreamStreaks)
    .set({
      kickCurrent: newStreak,
      kickLastUtcDate: today,
    })
    .where(eq(userStreamStreaks.userId, userId));

  await maybeStreamStreakBonus(userId, "kick", newStreak);
  return { ok: true, streak: newStreak, utcDate: today };
}
