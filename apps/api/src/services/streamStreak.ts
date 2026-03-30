import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userStreamStreaks } from "../db/schema.js";
import { gameConfig } from "../config.js";
import { applyCredit } from "./economy.js";
import { getKickAccount, getTwitchAccount } from "./platformTokens.js";
import {
  helixCheckFollow,
  helixGetOwnUser,
  helixIsStreamLive,
} from "../platforms/twitch/helix.js";
import {
  kickCheckFollowChannel,
  kickIsChannelLive,
} from "../platforms/kick/api.js";
import { utcDateString } from "./streak.js";

function addDays(isoDate: string, days: number): string {
  const [y, m, day] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function requireFollow(): boolean {
  const v = process.env.STREAM_STREAK_REQUIRE_FOLLOW?.trim();
  if (v === "0" || v === "false") return false;
  return true;
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

export type StreamStreakClaimResult =
  | {
      ok: true;
      platform: "twitch" | "kick";
      streak: number;
      utcDate: string;
    }
  | {
      ok: false;
      code:
        | "not_configured"
        | "no_oauth"
        | "not_live"
        | "not_following"
        | "already_today";
    };

export async function claimStreamStreak(
  userId: string,
  platform: "twitch" | "kick"
): Promise<StreamStreakClaimResult> {
  const today = utcDateString();
  const row = await ensureStreamStreakRow(userId);

  if (platform === "twitch") {
    if (row.twitchLast === today) {
      return { ok: false, code: "already_today" };
    }

    const login = process.env.TWITCH_STREAM_STREAK_BROADCASTER_LOGIN?.trim();
    if (!login) return { ok: false, code: "not_configured" };

    const acc = await getTwitchAccount(userId);
    if (!acc) return { ok: false, code: "no_oauth" };

    const live = await helixIsStreamLive(acc.accessToken, login);
    if (!live) return { ok: false, code: "not_live" };

    const me = await helixGetOwnUser(acc.accessToken);
    if (!me) return { ok: false, code: "no_oauth" };

    if (requireFollow()) {
      const following = await helixCheckFollow(
        acc.accessToken,
        me.id,
        login
      );
      if (!following) return { ok: false, code: "not_following" };
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
    return { ok: true, platform: "twitch", streak: newStreak, utcDate: today };
  }

  if (row.kickLast === today) {
    return { ok: false, code: "already_today" };
  }

  const slug = process.env.KICK_STREAM_STREAK_CHANNEL_SLUG?.trim();
  if (!slug) return { ok: false, code: "not_configured" };

  const acc = await getKickAccount(userId);
  if (!acc) return { ok: false, code: "no_oauth" };

  const live = await kickIsChannelLive(slug);
  if (!live) return { ok: false, code: "not_live" };

  if (requireFollow()) {
    const following = await kickCheckFollowChannel(acc.accessToken, slug);
    if (!following) return { ok: false, code: "not_following" };
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
  return { ok: true, platform: "kick", streak: newStreak, utcDate: today };
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
