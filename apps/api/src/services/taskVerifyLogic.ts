import { tasks } from "../db/schema.js";
import type { InferSelectModel } from "drizzle-orm";
import { parseTaskMeta } from "../taskMeta.js";
import { getKickAccount, getTwitchAccount } from "./platformTokens.js";
import {
  helixCheckFollow,
  helixCheckSubscription,
  helixGetOwnUser,
} from "../platforms/twitch/helix.js";
import {
  kickCheckFollowChannel,
  kickValidateToken,
} from "../platforms/kick/api.js";

export type TaskRow = InferSelectModel<typeof tasks>;

export async function verifyPlatformTask(
  userId: string,
  task: TaskRow
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const meta = parseTaskMeta(task.meta);

  if (task.platform === "twitch") {
    const acc = await getTwitchAccount(userId);
    if (!acc) return { ok: false, reason: "no_oauth" };
    const me = await helixGetOwnUser(acc.accessToken);
    if (!me) return { ok: false, reason: "helix_user" };

    const kind = meta?.helix?.kind ?? "connected";
    if (kind === "connected") return { ok: true };

    const login = meta?.helix?.broadcaster_login;
    if (!login) return { ok: false, reason: "no_broadcaster" };

    if (kind === "follow") {
      const ok = await helixCheckFollow(acc.accessToken, me.id, login);
      return ok ? { ok: true } : { ok: false, reason: "not_following" };
    }

    if (kind === "subscription") {
      const ok = await helixCheckSubscription(acc.accessToken, me.id, login);
      return ok ? { ok: true } : { ok: false, reason: "not_subscribed" };
    }
  }

  if (task.platform === "kick") {
    const acc = await getKickAccount(userId);
    if (!acc) return { ok: false, reason: "no_oauth" };
    const me = await kickValidateToken(acc.accessToken);
    if (!me) return { ok: false, reason: "kick_user" };

    const kind = meta?.kick?.kind ?? "connected";
    if (kind === "connected") return { ok: true };

    const slug = meta?.kick?.channel_slug;
    if (!slug) return { ok: false, reason: "no_channel" };

    if (kind === "follow") {
      const ok = await kickCheckFollowChannel(acc.accessToken, slug);
      return ok ? { ok: true } : { ok: false, reason: "not_following" };
    }
  }

  return { ok: false, reason: "unknown_platform" };
}
