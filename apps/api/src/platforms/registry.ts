import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformAccounts } from "../db/schema.js";
import { gameConfig } from "../config.js";
import type { PlatformProvider, TaskLike } from "./types.js";
import { getKickAccount, getTwitchAccount } from "../services/platformTokens.js";

class TwitchProvider implements PlatformProvider {
  id = "twitch" as const;
  async verifyTask(userId: string, task: TaskLike): Promise<boolean> {
    if (task.validationType === "manual") {
      const [row] = await db
        .select()
        .from(platformAccounts)
        .where(
          and(
            eq(platformAccounts.userId, userId),
            eq(platformAccounts.platform, "twitch")
          )
        )
        .limit(1);
      return !!row;
    }
    if (task.validationType === "api") {
      const acc = await getTwitchAccount(userId);
      return !!acc;
    }
    return false;
  }
}

class TelegramProvider implements PlatformProvider {
  id = "telegram" as const;
  async verifyTask(_userId: string, _task: TaskLike): Promise<boolean> {
    return true;
  }
}

class KickProvider implements PlatformProvider {
  id = "kick" as const;
  async verifyTask(userId: string, task: TaskLike): Promise<boolean> {
    if (task.validationType === "manual") {
      const [row] = await db
        .select()
        .from(platformAccounts)
        .where(
          and(
            eq(platformAccounts.userId, userId),
            eq(platformAccounts.platform, "kick")
          )
        )
        .limit(1);
      return !!row;
    }
    if (task.validationType === "api") {
      const acc = await getKickAccount(userId);
      return !!acc;
    }
    return false;
  }
}

const twitch = new TwitchProvider();
const kick = new KickProvider();
const telegram = new TelegramProvider();

export function getProvider(platform: string): PlatformProvider | null {
  if (platform === "global") return null;
  if (platform === "telegram") return telegram;
  if (platform === "twitch") {
    return gameConfig.platforms.twitchEnabled ? twitch : null;
  }
  if (platform === "kick") {
    return gameConfig.platforms.kickEnabled ? kick : null;
  }
  return null;
}

export async function canCompletePlatformTask(
  userId: string,
  task: TaskLike
): Promise<boolean> {
  if (task.platform === "global") return true;
  const p = getProvider(task.platform);
  if (!p) return false;
  return p.verifyTask(userId, task);
}
