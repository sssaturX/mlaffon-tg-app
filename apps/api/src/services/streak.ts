import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userStreaks } from "../db/schema.js";
import { gameConfig } from "../config.js";
import { applyCredit } from "./economy.js";

export function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, day] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Updates streak on app open; may grant streak milestone bonus (idempotent per milestone).
 */
export async function touchActivityAndStreak(userId: string): Promise<{
  streak: number;
  lastDate: string | null;
}> {
  const today = utcDateString();
  const [row] = await db
    .select()
    .from(userStreaks)
    .where(eq(userStreaks.userId, userId))
    .limit(1);

  if (!row) {
    await db.insert(userStreaks).values({
      userId,
      currentStreak: 1,
      lastActivityUtcDate: today,
    });
    return { streak: 1, lastDate: today };
  }

  const last = row.lastActivityUtcDate;
  if (last === today) {
    return { streak: row.currentStreak, lastDate: last };
  }

  let newStreak: number;
  if (!last) {
    newStreak = 1;
  } else if (last === addDays(today, -1)) {
    newStreak = row.currentStreak + 1;
  } else {
    newStreak = 1;
  }

  await db
    .update(userStreaks)
    .set({
      currentStreak: newStreak,
      lastActivityUtcDate: today,
    })
    .where(eq(userStreaks.userId, userId));

  const { bonusEveryDays, bonusCoins } = gameConfig.streak;
  if (bonusEveryDays > 0 && newStreak > 0 && newStreak % bonusEveryDays === 0) {
    const idem = `streak_bonus:${userId}:${newStreak}`;
    await applyCredit({
      userId,
      amount: bonusCoins,
      idempotencyKey: idem,
      kind: "streak_bonus",
      referenceType: "streak",
      referenceId: String(newStreak),
    });
  }

  return { streak: newStreak, lastDate: today };
}
