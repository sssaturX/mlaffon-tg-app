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
): Promise<number> {
  const cfg = gameConfig.streamStreak;
  if (
    cfg.bonusEveryStreams <= 0 ||
    newStreak <= 0 ||
    newStreak % cfg.bonusEveryStreams !== 0
  ) {
    return 0;
  }
  const idem = `stream_streak_bonus:${platform}:${userId}:${newStreak}`;
  const res = await applyCredit({
    userId,
    amount: cfg.bonusCoins,
    idempotencyKey: idem,
    kind: "streak_bonus",
    platform,
    referenceType: "stream_streak",
    referenceId: `${platform}:${newStreak}`,
  });
  if (res.ok) return res.creditedAmount;
  return 0;
}

/**
 * Стрик за «Смотреть стрим»: **каждая новая трансляция** (новый эфир в админке) даёт +1,
 * даже если в тот же UTC-день уже был другой эфир. Повторное нажатие в том же эфире
 * не вызывается (см. live_broadcast_views).
 *
 * Логика: первый эфир за календарный день продолжает цепочку «вчера → сегодня»;
 * второй и следующие эфиры **в тот же день** добавляют ещё +1 к счётчику сессий.
 * Длинный перерыв (не вчера и не сегодня) — сброс в 1.
 */
export async function applyStreamStreakBroadcastWatch(
  userId: string,
  platform: "twitch" | "kick"
): Promise<{
  ok: true;
  streak: number;
  utcDate: string;
  bonusCoinsAwarded: number;
}> {
  const today = utcDateString();
  const row = await ensureStreamStreakRow(userId);

  if (platform === "twitch") {
    const last = row.twitchLast;
    let newStreak: number;

    if (!last) {
      newStreak = 1;
    } else if (last === today) {
      newStreak = row.twitch + 1;
    } else if (last === addDays(today, -1)) {
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

    const bonusCoinsAwarded = await maybeStreamStreakBonus(
      userId,
      "twitch",
      newStreak
    );
    return { ok: true, streak: newStreak, utcDate: today, bonusCoinsAwarded };
  }

  const last = row.kickLast;
  let newStreak: number;

  if (!last) {
    newStreak = 1;
  } else if (last === today) {
    newStreak = row.kick + 1;
  } else if (last === addDays(today, -1)) {
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

  const bonusCoinsAwarded = await maybeStreamStreakBonus(
    userId,
    "kick",
    newStreak
  );
  return { ok: true, streak: newStreak, utcDate: today, bonusCoinsAwarded };
}
