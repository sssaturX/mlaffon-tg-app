import { asc, eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "../db/index.js";
import { tasks } from "../db/schema.js";
import { invalidateActiveTasksCache } from "./taskCatalogCache.js";

export async function listTasksAdmin() {
  return db.select().from(tasks).orderBy(asc(tasks.id));
}

export async function createTaskAdmin(row: {
  id: string;
  title: string;
  description: string;
  reward: number;
  platform: string;
  type: string;
  validationType: string;
  meta: Record<string, unknown> | null;
  active: boolean;
}) {
  await db.insert(tasks).values({
    id: row.id,
    title: row.title,
    description: row.description,
    reward: row.reward,
    platform: row.platform,
    type: row.type,
    validationType: row.validationType,
    meta: row.meta,
    active: row.active,
  });
  invalidateActiveTasksCache();
}

export async function updateTaskAdmin(
  id: string,
  patch: {
    title?: string;
    description?: string;
    reward?: number;
    platform?: string;
    type?: string;
    validationType?: string;
    meta?: Record<string, unknown> | null;
    active?: boolean;
  }
) {
  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.reward !== undefined) set.reward = patch.reward;
  if (patch.platform !== undefined) set.platform = patch.platform;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.validationType !== undefined)
    set.validationType = patch.validationType;
  if (patch.meta !== undefined) set.meta = patch.meta;
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length === 0) return false;

  const [u] = await db
    .update(tasks)
    .set(set as Partial<InferInsertModel<typeof tasks>>)
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id });
  if (u != null) invalidateActiveTasksCache();
  return u != null;
}

export async function setTaskActive(id: string, active: boolean) {
  const [u] = await db
    .update(tasks)
    .set({ active })
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id });
  if (u != null) invalidateActiveTasksCache();
  return u != null;
}

/** Полное удаление строки задания; user_tasks и task_evidence удаляются каскадом в БД. */
export async function deleteTaskAdmin(id: string) {
  const [d] = await db
    .delete(tasks)
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id });
  if (d != null) invalidateActiveTasksCache();
  return d != null;
}
