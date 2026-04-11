import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { tasks, userTasks } from "../db/schema.js";
import { verifyPlatformTask } from "../services/taskVerifyLogic.js";
import { grantTaskReward } from "../services/taskRewards.js";
import { invalidateUserTaskDtoCache } from "../services/taskUserListCache.js";

export async function processVerifyTaskJob(data: {
  userId: string;
  taskId: string;
  periodKey: string;
}): Promise<void> {
  const { userId, taskId, periodKey } = data;

  const [t] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!t) return;

  const v = await verifyPlatformTask(userId, t);
  if (!v.ok) {
    await db
      .update(userTasks)
      .set({
        status: "available",
        lastError: v.reason,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(userTasks.userId, userId),
          eq(userTasks.taskId, taskId),
          eq(userTasks.periodKey, periodKey)
        )
      );
    invalidateUserTaskDtoCache(userId);
    return;
  }

  try {
    await grantTaskReward({ userId, task: t, periodKey });
  } catch {
    await db
      .update(userTasks)
      .set({
        status: "available",
        lastError: "grant_failed",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(userTasks.userId, userId),
          eq(userTasks.taskId, taskId),
          eq(userTasks.periodKey, periodKey)
        )
      );
    invalidateUserTaskDtoCache(userId);
  }
}
