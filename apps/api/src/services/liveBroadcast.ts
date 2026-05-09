import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { liveBroadcasts, liveBroadcastViews } from "../db/schema.js";
import {
  applyStreamStreakBroadcastWatch,
  ensureStreamStreakRow,
  resetStreamStreakForMissedBroadcastTx,
} from "./streamStreak.js";
import { publishBroadcastEvent } from "./realtimePublish.js";
import { deactivateActiveDropsOnStreamEnd } from "./drops.js";
import { scheduleLiveAutoEndJob } from "./domainScheduler.js";
import {
  flushAllUserTaskDtoCaches,
  invalidateUserTaskDtoCache,
} from "./taskUserListCache.js";

export type LivePlatform = "twitch" | "kick";

export async function getActiveLiveBroadcast() {
  const [row] = await db
    .select()
    .from(liveBroadcasts)
    .where(isNull(liveBroadcasts.endedAt))
    .orderBy(desc(liveBroadcasts.startedAt))
    .limit(1);
  return row ?? null;
}

export async function startLiveBroadcast(input: {
  platform: LivePlatform;
  streamUrl: string;
  vpnNote?: string | null;
}): Promise<
  | { ok: true; id: string }
  | { ok: false; code: "already_live" | "bad_url" }
> {
  const url = input.streamUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { ok: false, code: "bad_url" };
  }

  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${liveBroadcasts} IN SHARE ROW EXCLUSIVE MODE`);

    const [active] = await tx
      .select({ id: liveBroadcasts.id })
      .from(liveBroadcasts)
      .where(isNull(liveBroadcasts.endedAt))
      .limit(1);

    if (active) return null;

    const [row] = await tx
      .insert(liveBroadcasts)
      .values({
        platform: input.platform,
        streamUrl: url,
        vpnNote: input.vpnNote?.trim() || null,
      })
      .returning({
        id: liveBroadcasts.id,
        startedAt: liveBroadcasts.startedAt,
      });

    return row ?? null;
  });

  if (!inserted) {
    return { ok: false, code: "already_live" };
  }

  void publishBroadcastEvent({
    type: "live_started",
    v: 1,
    data: {
      id: inserted.id,
      platform: input.platform,
      streamUrl: url,
      startedAt: inserted.startedAt.toISOString(),
      vpnNote: input.vpnNote?.trim() || null,
    },
  });
  void flushAllUserTaskDtoCaches();

  const autoEndMs = Number.parseInt(
    process.env.LIVE_BROADCAST_AUTO_END_MS ?? "0",
    10
  );
  if (Number.isFinite(autoEndMs) && autoEndMs > 0) {
    void scheduleLiveAutoEndJob(inserted.id, autoEndMs);
  }

  return { ok: true, id: inserted.id };
}

export async function endLiveBroadcast(): Promise<
  { ok: true } | { ok: false; code: "not_live" }
> {
  const active = await getActiveLiveBroadcast();
  if (!active) {
    return { ok: false, code: "not_live" };
  }
  const platform: LivePlatform =
    active.platform === "twitch" ? "twitch" : "kick";
  const broadcastId = active.id;

  await db.transaction(async (tx) => {
    await tx
      .update(liveBroadcasts)
      .set({ endedAt: new Date() })
      .where(eq(liveBroadcasts.id, broadcastId));
    await resetStreamStreakForMissedBroadcastTx(tx, broadcastId, platform);
  });

  void publishBroadcastEvent({ type: "live_ended", v: 1 });
  void flushAllUserTaskDtoCaches();
  await deactivateActiveDropsOnStreamEnd();
  return { ok: true };
}

export async function watchLiveBroadcast(
  userId: string,
  broadcastId: string
): Promise<
  | {
      ok: true;
      platform: LivePlatform;
      streak: number;
      streakIncremented: boolean;
      alreadyWatchedThisBroadcast: boolean;
      bonusCoinsAwarded: number;
    }
  | { ok: false; code: "not_active" | "bad_broadcast" }
> {
  const [b] = await db
    .select()
    .from(liveBroadcasts)
    .where(eq(liveBroadcasts.id, broadcastId))
    .limit(1);

  if (!b) {
    return { ok: false, code: "bad_broadcast" };
  }
  if (b.endedAt) {
    return { ok: false, code: "not_active" };
  }

  const platform: LivePlatform =
    b.platform === "twitch" ? "twitch" : "kick";

  const [existing] = await db
    .select({ id: liveBroadcastViews.id })
    .from(liveBroadcastViews)
    .where(
      and(
        eq(liveBroadcastViews.broadcastId, broadcastId),
        eq(liveBroadcastViews.userId, userId)
      )
    )
    .limit(1);

  if (existing) {
    const r = await ensureStreamStreakRow(userId);
    return {
      ok: true,
      platform,
      streak: platform === "twitch" ? r.twitch : r.kick,
      streakIncremented: false,
      alreadyWatchedThisBroadcast: true,
      bonusCoinsAwarded: 0,
    };
  }

  try {
    await db.insert(liveBroadcastViews).values({
      broadcastId,
      userId,
    });
  } catch (e: unknown) {
    const isUniqueViolation =
      e instanceof Error && e.message.includes("duplicate key");
    if (isUniqueViolation) {
      const r = await ensureStreamStreakRow(userId);
      return {
        ok: true,
        platform,
        streak: platform === "twitch" ? r.twitch : r.kick,
        streakIncremented: false,
        alreadyWatchedThisBroadcast: true,
        bonusCoinsAwarded: 0,
      };
    }
    throw e;
  }

  const res = await applyStreamStreakBroadcastWatch(userId, platform);
  invalidateUserTaskDtoCache(userId);

  return {
    ok: true,
    platform,
    streak: res.streak,
    streakIncremented: true,
    alreadyWatchedThisBroadcast: false,
    bonusCoinsAwarded: res.bonusCoinsAwarded,
  };
}
