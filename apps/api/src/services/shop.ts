import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { shopItems, userInventory } from "../db/schema.js";
import { applyDebit, type EconomyPlatform } from "./economy.js";
import { nanoid } from "nanoid";

export async function purchaseItem(
  userId: string,
  itemId: string,
  platform: EconomyPlatform
): Promise<
  { ok: true; coins: number } | { ok: false; error: string }
> {
  const [item] = await db
    .select()
    .from(shopItems)
    .where(eq(shopItems.id, itemId))
    .limit(1);
  if (!item || !item.active) return { ok: false, error: "item_not_found" };

  const idem = `shop:${userId}:${itemId}:${nanoid()}`;
  const debit = await applyDebit({
    userId,
    amount: item.priceCoins,
    platform,
    idempotencyKey: idem,
    kind: "shop_purchase",
    referenceType: "shop_item",
    referenceId: itemId,
  });
  if (!debit.ok) {
    if (debit.reason === "insufficient")
      return { ok: false, error: "insufficient_coins" };
    return { ok: false, error: "duplicate" };
  }

  if (item.kind === "extra_spin") {
    const qty = (item.meta as { spins?: number } | null)?.spins ?? 1;
    await db
      .insert(userInventory)
      .values({
        userId,
        itemId: "extra_spin",
        quantity: qty,
      })
      .onConflictDoUpdate({
        target: [userInventory.userId, userInventory.itemId],
        set: {
          quantity: sql`${userInventory.quantity} + ${qty}`,
          updatedAt: sql`now()`,
        },
      });
  } else if (item.kind === "boost") {
    await db
      .insert(userInventory)
      .values({
        userId,
        itemId: "boost_x2",
        quantity: 1,
      })
      .onConflictDoUpdate({
        target: [userInventory.userId, userInventory.itemId],
        set: {
          quantity: sql`${userInventory.quantity} + 1`,
          updatedAt: sql`now()`,
        },
      });
  }

  return { ok: true, coins: debit.newCoins };
}

export async function listShopItems() {
  return db.select().from(shopItems).where(eq(shopItems.active, true));
}
