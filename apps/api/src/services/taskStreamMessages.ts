import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { liveBroadcastViews, taskStreamMessages } from "../db/schema.js";
import { getActiveLiveBroadcast } from "./liveBroadcast.js";
import { invalidateUserTaskDtoCache } from "./taskUserListCache.js";

function utcMinuteKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

export async function registerStreamTaskMessage(input: {
  userId: string;
  platform: "twitch" | "kick";
  text: string;
}): Promise<
  | { ok: true; accepted: true; totalForPlatform: number }
  | {
      ok: false;
      code: "not_live" | "platform_mismatch" | "watch_required" | "too_frequent" | "message_too_short";
    }
> {
  if (input.text.trim().length < 2) return { ok: false, code: "message_too_short" };
  const live = await getActiveLiveBroadcast();
  if (!live) return { ok: false, code: "not_live" };
  if (live.platform !== input.platform) return { ok: false, code: "platform_mismatch" };

  const [seen] = await db
    .select({ id: liveBroadcastViews.id })
    .from(liveBroadcastViews)
    .where(
      and(
        eq(liveBroadcastViews.userId, input.userId),
        eq(liveBroadcastViews.broadcastId, live.id)
      )
    )
    .limit(1);
  if (!seen) return { ok: false, code: "watch_required" };

  const minuteKey = utcMinuteKey(new Date());
  const inserted = await db
    .insert(taskStreamMessages)
    .values({
      userId: input.userId,
      platform: input.platform,
      broadcastId: live.id,
      minuteKey,
    })
    .onConflictDoNothing()
    .returning({ id: taskStreamMessages.id });
  if (inserted.length === 0) return { ok: false, code: "too_frequent" };
  invalidateUserTaskDtoCache(input.userId);

  const [total] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(taskStreamMessages)
    .where(
      and(
        eq(taskStreamMessages.userId, input.userId),
        eq(taskStreamMessages.platform, input.platform)
      )
    );
  return { ok: true, accepted: true, totalForPlatform: total?.c ?? 0 };
}
