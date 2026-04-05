import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { tasks, userBalances, userTasks } from "../db/schema.js";
import { applyCredit, applyCreditSplit } from "./economy.js";
import { reverseTaskRewardCredit } from "./taskRewardCompensation.js";
import { computeLevel, computeRewardMultiplier } from "../config.js";
import { maybeQualifyReferral } from "./referrals.js";
import type { TaskRow } from "./taskVerifyLogic.js";

export async function grantTaskReward(params: {
  userId: string;
  task: TaskRow;
  periodKey: string;
}): Promise<{ ok: true; coins: number; reward: number }> {
  const { userId, task, periodKey } = params;
  const rewardPlatform: "twitch" | "kick" | "split" =
    task.platform === "twitch" ? "twitch" : task.platform === "kick" ? "kick" : "split";

  const [b] = await db
    .select({ lifetimeEarned: userBalances.lifetimeEarned })
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);

  const level = computeLevel(b?.lifetimeEarned ?? 0);
  const mult = computeRewardMultiplier(level);
  const reward = Math.floor(task.reward * mult);

  const idem = `task:${userId}:${task.id}:${periodKey}`;
  const credit =
    task.platform === "twitch"
      ? await applyCredit({
          userId,
          amount: reward,
          idempotencyKey: idem,
          kind: "task_reward",
          platform: "twitch",
          referenceType: "task",
          referenceId: task.id,
          meta: { baseReward: task.reward, level, mult },
        })
      : task.platform === "kick"
        ? await applyCredit({
            userId,
            amount: reward,
            idempotencyKey: idem,
            kind: "task_reward",
            platform: "kick",
            referenceType: "task",
            referenceId: task.id,
            meta: { baseReward: task.reward, level, mult },
          })
        : await applyCreditSplit({
            userId,
            amount: reward,
            idempotencyKey: idem,
            kind: "task_reward",
            referenceType: "task",
            referenceId: task.id,
            meta: { baseReward: task.reward, level, mult },
          });

  if (!credit.ok) {
    if (credit.reason === "duplicate") {
      const [bal] = await db
        .select({ coins: userBalances.coins })
        .from(userBalances)
        .where(eq(userBalances.userId, userId))
        .limit(1);
      return {
        ok: true,
        coins: bal?.coins ?? 0,
        reward,
      };
    }
    throw new Error("credit_failed");
  }

  const [existing] = await db
    .select()
    .from(userTasks)
    .where(
      and(
        eq(userTasks.userId, userId),
        eq(userTasks.taskId, task.id),
        eq(userTasks.periodKey, periodKey)
      )
    )
    .limit(1);

  const refundPlatform: "twitch" | "kick" | "global" =
    task.platform === "twitch"
      ? "twitch"
      : task.platform === "kick"
        ? "kick"
        : "global";

  try {
    if (existing) {
      await db
        .update(userTasks)
        .set({
          status: "completed",
          lastError: null,
          rewardGranted: credit.creditedAmount,
          rewardPlatform,
          updatedAt: sql`now()`,
        })
        .where(eq(userTasks.id, existing.id));
    } else {
      await db.insert(userTasks).values({
        userId,
        taskId: task.id,
        status: "completed",
        periodKey,
        rewardGranted: credit.creditedAmount,
        rewardPlatform,
      });
    }
  } catch {
    await reverseTaskRewardCredit({
      userId,
      taskId: task.id,
      periodKey,
      platform: refundPlatform,
      amount: credit.creditedAmount,
    });
    throw new Error("task_persist_failed");
  }

  await maybeQualifyReferral(userId);

  return { ok: true, coins: credit.newCoins, reward: credit.creditedAmount };
}
