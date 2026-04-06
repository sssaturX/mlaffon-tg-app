import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { userInventory } from "../db/schema.js";

export const STREAK_SAVE_ITEM_ID = "streak_save";
export const STREAK_PLUS_ITEM_ID = "streak_plus";

export async function getInventoryCounts(
  userId: string
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      itemId: userInventory.itemId,
      qty: userInventory.quantity,
    })
    .from(userInventory)
    .where(eq(userInventory.userId, userId));

  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.qty > 0) out[r.itemId] = r.qty;
  }
  return out;
}

export async function addInventoryItem(
  userId: string,
  itemId: string,
  delta: number
): Promise<void> {
  if (delta <= 0) return;

  await db
    .insert(userInventory)
    .values({ userId, itemId, quantity: delta })
    .onConflictDoUpdate({
      target: [userInventory.userId, userInventory.itemId],
      set: {
        quantity: sql`${userInventory.quantity} + ${delta}`,
        updatedAt: sql`now()`,
      },
    });
}

/** Списывает предмет, если на счёте достаточно количества. */
export async function tryConsumeInventoryItem(
  userId: string,
  itemId: string,
  amount = 1
): Promise<boolean> {
  if (amount <= 0) return false;

  const [before] = await db
    .select({ quantity: userInventory.quantity })
    .from(userInventory)
    .where(
      and(eq(userInventory.userId, userId), eq(userInventory.itemId, itemId))
    )
    .limit(1);
  const q0 = before?.quantity ?? 0;
  if (q0 < amount) return false;

  await db
    .update(userInventory)
    .set({
      quantity: sql`${userInventory.quantity} - ${amount}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(userInventory.userId, userId), eq(userInventory.itemId, itemId))
    );
  return true;
}
