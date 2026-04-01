import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { tasks, userBalances, userTasks } from "../db/schema.js";
import { utcDateString } from "./streak.js";
import { canCompletePlatformTask } from "../platforms/registry.js";
import { computeLevel, computeRewardMultiplier } from "../config.js";
import { maybeQualifyReferral } from "./referrals.js";
import { applyCredit, applyCreditSplit } from "./economy.js";
import { reverseTaskRewardCredit } from "./taskRewardCompensation.js";
import { getTaskVerifyQueue } from "../queue/bullmq.js";
import type { TaskDto, UserTaskStatus } from "shared";
import { extractTaskUiFields } from "./taskUiMeta.js";

function periodKeyForTask(task: { type: string }): string {
  if (task.type === "daily") return utcDateString();
  return "once";
}

export async function listTasksForUser(userId: string): Promise<TaskDto[]> {
  const all = await db.select().from(tasks).where(eq(tasks.active, true));

  const rows: TaskDto[] = [];
  for (const t of all) {
    const pk = periodKeyForTask(t);
    const [ut] = await db
      .select()
      .from(userTasks)
      .where(
        and(
          eq(userTasks.userId, userId),
          eq(userTasks.taskId, t.id),
          eq(userTasks.periodKey, pk)
        )
      )
      .limit(1);

    let userStatus: UserTaskStatus = "available";
    if (ut?.status === "completed") userStatus = "completed";
    else if (ut?.status === "pending") userStatus = "pending";
    else if (t.type === "one-time") {
      const [anyDone] = await db
        .select()
        .from(userTasks)
        .where(
          and(
            eq(userTasks.userId, userId),
            eq(userTasks.taskId, t.id),
            eq(userTasks.status, "completed")
          )
        )
        .limit(1);
      if (anyDone) userStatus = "completed";
    }

    if (t.platform !== "global") {
      const ok = await canCompletePlatformTask(userId, {
        id: t.id,
        platform: t.platform,
        validationType: t.validationType,
        meta: t.meta,
      });
      if (!ok && userStatus !== "completed" && userStatus !== "pending") {
        userStatus = "locked";
      }
    }

    const meta = (t.meta as Record<string, unknown> | null) ?? null;
    const ui = extractTaskUiFields(meta);
    rows.push({
      id: t.id,
      title: t.title,
      description: t.description,
      reward: t.reward,
      platform: t.platform as TaskDto["platform"],
      type: t.type as TaskDto["type"],
      validationType: t.validationType as TaskDto["validationType"],
      userStatus,
      periodKey: t.type === "daily" ? pk : null,
      meta,
      lastError: ut?.lastError ?? null,
      actionUrl: ui.actionUrl,
      actionLabel: ui.actionLabel,
      verifyLabel: ui.verifyLabel,
      help: ui.help,
    });
  }
  return rows;
}

export async function claimTask(
  userId: string,
  taskId: string
): Promise<
  | { ok: true; mode: "sync"; coins: number; reward: number }
  | { ok: true; mode: "async"; jobId: string }
  | { ok: false; error: string }
> {
  const [t] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.active, true)))
    .limit(1);
  if (!t) return { ok: false, error: "task_not_found" };

  const pk = periodKeyForTask(t);

  if (t.type === "one-time") {
    const [done] = await db
      .select()
      .from(userTasks)
      .where(
        and(
          eq(userTasks.userId, userId),
          eq(userTasks.taskId, taskId),
          eq(userTasks.status, "completed")
        )
      )
      .limit(1);
    if (done) return { ok: false, error: "already_completed" };
  }

  const [existing] = await db
    .select()
    .from(userTasks)
    .where(
      and(
        eq(userTasks.userId, userId),
        eq(userTasks.taskId, taskId),
        eq(userTasks.periodKey, pk)
      )
    )
    .limit(1);
  if (existing?.status === "completed")
    return { ok: false, error: "already_completed" };

  const platformOk = await canCompletePlatformTask(userId, {
    id: t.id,
    platform: t.platform,
    validationType: t.validationType,
    meta: t.meta,
  });
  if (!platformOk) return { ok: false, error: "platform_required" };

  if (t.validationType === "api") {
    const jobId = `v:${userId}:${taskId}:${pk}`;
    if (existing?.status === "pending") {
      return { ok: true, mode: "async", jobId };
    }

    if (existing) {
      await db
        .update(userTasks)
        .set({
          status: "pending",
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(userTasks.id, existing.id));
    } else {
      await db.insert(userTasks).values({
        userId,
        taskId,
        status: "pending",
        periodKey: pk,
      });
    }

    try {
      const q = getTaskVerifyQueue();
      await q.add(
        "verify",
        { userId, taskId, periodKey: pk },
        {
          jobId,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );
    } catch {
      await db
        .update(userTasks)
        .set({
          status: "available",
          lastError: "queue_unavailable",
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(userTasks.userId, userId),
            eq(userTasks.taskId, taskId),
            eq(userTasks.periodKey, pk)
          )
        );
      return { ok: false, error: "queue_unavailable" };
    }

    return { ok: true, mode: "async", jobId };
  }

  const [b] = await db
    .select({ lifetimeEarned: userBalances.lifetimeEarned })
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);

  const level = computeLevel(b?.lifetimeEarned ?? 0);
  const mult = computeRewardMultiplier(level);
  const reward = Math.floor(t.reward * mult);

  const idem = `task:${userId}:${taskId}:${pk}`;
  const credit =
    t.platform === "twitch"
      ? await applyCredit({
          userId,
          amount: reward,
          idempotencyKey: idem,
          kind: "task_reward",
          platform: "twitch",
          referenceType: "task",
          referenceId: taskId,
          meta: { baseReward: t.reward, level, mult },
        })
      : t.platform === "kick"
        ? await applyCredit({
            userId,
            amount: reward,
            idempotencyKey: idem,
            kind: "task_reward",
            platform: "kick",
            referenceType: "task",
            referenceId: taskId,
            meta: { baseReward: t.reward, level, mult },
          })
        : await applyCreditSplit({
            userId,
            amount: reward,
            idempotencyKey: idem,
            kind: "task_reward",
            referenceType: "task",
            referenceId: taskId,
            meta: { baseReward: t.reward, level, mult },
          });

  if (!credit.ok) return { ok: false, error: "already_completed" };

  const refundPlatform: "twitch" | "kick" | "global" =
    t.platform === "twitch"
      ? "twitch"
      : t.platform === "kick"
        ? "kick"
        : "global";

  try {
    if (existing) {
      await db
        .update(userTasks)
        .set({ status: "completed", lastError: null, updatedAt: sql`now()` })
        .where(eq(userTasks.id, existing.id));
    } else {
      await db.insert(userTasks).values({
        userId,
        taskId,
        status: "completed",
        periodKey: pk,
      });
    }
  } catch {
    await reverseTaskRewardCredit({
      userId,
      taskId,
      periodKey: pk,
      platform: refundPlatform,
      amount: credit.creditedAmount,
    });
    throw new Error("task_persist_failed");
  }

  await maybeQualifyReferral(userId);

  return {
    ok: true,
    mode: "sync",
    coins: credit.newCoins,
    reward: credit.creditedAmount,
  };
}
