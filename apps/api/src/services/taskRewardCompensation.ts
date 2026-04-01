import { applyDebit } from "./economy.js";

/**
 * Отмена начисления задания, если запись user_tasks не удалась после успешного credit.
 * Идемпотентные ключи не пересекаются с начислением.
 */
export async function reverseTaskRewardCredit(params: {
  userId: string;
  taskId: string;
  periodKey: string;
  platform: "twitch" | "kick" | "global";
  amount: number;
}): Promise<void> {
  const { userId, taskId, periodKey, platform, amount } = params;
  if (amount <= 0) return;

  const base = `task_refund:${userId}:${taskId}:${periodKey}`;

  if (platform === "twitch") {
    const r = await applyDebit({
      userId,
      amount,
      idempotencyKey: base,
      kind: "task_reward_refund",
      platform: "twitch",
      referenceType: "task",
      referenceId: taskId,
    });
    if (!r.ok && r.reason !== "duplicate") {
      throw new Error("task_refund_twitch_failed");
    }
    return;
  }

  if (platform === "kick") {
    const r = await applyDebit({
      userId,
      amount,
      idempotencyKey: base,
      kind: "task_reward_refund",
      platform: "kick",
      referenceType: "task",
      referenceId: taskId,
    });
    if (!r.ok && r.reason !== "duplicate") {
      throw new Error("task_refund_kick_failed");
    }
    return;
  }

  const half = Math.floor(amount / 2);
  const rest = amount - half;
  const r1 = await applyDebit({
    userId,
    amount: half,
    idempotencyKey: `${base}:tw`,
    kind: "task_reward_refund",
    platform: "twitch",
    referenceType: "task",
    referenceId: taskId,
  });
  if (!r1.ok && r1.reason !== "duplicate") {
    throw new Error("task_refund_split_tw_failed");
  }
  const r2 = await applyDebit({
    userId,
    amount: rest,
    idempotencyKey: `${base}:kick`,
    kind: "task_reward_refund",
    platform: "kick",
    referenceType: "task",
    referenceId: taskId,
  });
  if (!r2.ok && r2.reason !== "duplicate") {
    throw new Error("task_refund_split_ki_failed");
  }
}
