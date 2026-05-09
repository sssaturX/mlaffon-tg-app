import { eq, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "../db/index.js";
import { userStreamStreaks, users } from "../db/schema.js";
import { gameConfig } from "../config.js";
import { applyCredit } from "./economy.js";
import { utcDateString } from "./streak.js";

export async function ensureStreamStreakRow(
  userId: string
): Promise<{
  twitch: number;
  kick: number;
  twitchLast: string | null;
  kickLast: string | null;
}> {
  const [exists] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!exists) {
    return { twitch: 0, kick: 0, twitchLast: null, kickLast: null };
  }

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
  const milestone = cfg.milestoneBonuses?.find((m) => m.streams === newStreak);
  const bonusCoins = milestone?.coins ?? (
    cfg.bonusEveryStreams > 0 &&
    newStreak > 0 &&
    newStreak % cfg.bonusEveryStreams === 0
      ? cfg.bonusCoins
      : 0
  );
  if (
    bonusCoins <= 0
  ) {
    return 0;
  }
  const idem = `stream_streak_bonus:${platform}:${userId}:${newStreak}`;
  const res = await applyCredit({
    userId,
    amount: bonusCoins,
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
 * Логика стрика привязана к последовательности эфиров, а не к календарным дням.
 * Пропуск обнуляется при завершении конкретного эфира в resetStreamStreakForMissedBroadcastTx.
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
    let newStreak: number;

    newStreak = Math.max(0, row.twitch) + 1;

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

  let newStreak: number;

  newStreak = Math.max(0, row.kick) + 1;

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

type TxExecute = {
  execute: (query: string | SQLWrapper) => Promise<unknown>;
};

/**
 * Завершение эфира: у кого был стрик по платформе, но нет отметки «смотрел этот эфир» — стрик обнуляется.
 */
export async function resetStreamStreakForMissedBroadcastTx(
  tx: TxExecute,
  broadcastId: string,
  platform: "twitch" | "kick"
): Promise<void> {
  if (platform === "twitch") {
    await tx.execute(sql`
      UPDATE user_stream_streaks
      SET twitch_current = 0,
          twitch_last_utc_date = NULL
      WHERE twitch_current > 0
        AND NOT EXISTS (
          SELECT 1 FROM live_broadcast_views lbv
          WHERE lbv.broadcast_id = ${broadcastId}
            AND lbv.user_id = user_stream_streaks.user_id
        )
    `);
    return;
  }
  await tx.execute(sql`
    UPDATE user_stream_streaks
    SET kick_current = 0,
        kick_last_utc_date = NULL
    WHERE kick_current > 0
      AND NOT EXISTS (
        SELECT 1 FROM live_broadcast_views lbv
        WHERE lbv.broadcast_id = ${broadcastId}
          AND lbv.user_id = user_stream_streaks.user_id
      )
  `);
}
