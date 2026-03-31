import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { liveBroadcasts, liveBroadcastViews } from "../db/schema.js";
import {
  applyStreamStreakBroadcastWatch,
  ensureStreamStreakRow,
} from "./streamStreak.js";

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

  const active = await getActiveLiveBroadcast();
  if (active) {
    return { ok: false, code: "already_live" };
  }

  const [inserted] = await db
    .insert(liveBroadcasts)
    .values({
      platform: input.platform,
      streamUrl: url,
      vpnNote: input.vpnNote?.trim() || null,
    })
    .returning({ id: liveBroadcasts.id });

  return { ok: true, id: inserted!.id };
}

export async function endLiveBroadcast(): Promise<
  { ok: true } | { ok: false; code: "not_live" }
> {
  const active = await getActiveLiveBroadcast();
  if (!active) {
    return { ok: false, code: "not_live" };
  }
  await db
    .update(liveBroadcasts)
    .set({ endedAt: new Date() })
    .where(eq(liveBroadcasts.id, active.id));
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
    };
  }

  const res = await applyStreamStreakBroadcastWatch(userId, platform);

  await db.insert(liveBroadcastViews).values({
    broadcastId,
    userId,
  });

  return {
    ok: true,
    platform,
    streak: res.streak,
    streakIncremented: true,
    alreadyWatchedThisBroadcast: false,
  };
}
