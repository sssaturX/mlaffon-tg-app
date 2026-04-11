import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { shopItems, userInventory } from "../db/schema.js";
import { applyCredit, applyDebit, type EconomyPlatform } from "./economy.js";
import { nanoid } from "nanoid";

export type ShopItemClientDto = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  priceCoins: number;
  meta: unknown;
  /** null — без лимита; 0 — закончилось. */
  stockRemaining: number | null;
};

export async function listShopItemsForClient(): Promise<ShopItemClientDto[]> {
  const rows = await db.select().from(shopItems).where(eq(shopItems.active, true));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    kind: r.kind,
    priceCoins: r.priceCoins,
    meta: r.meta ?? null,
    stockRemaining:
      r.stockTotal == null ? null : Math.max(0, r.stockTotal - r.stockSold),
  }));
}

export async function purchaseItem(
  userId: string,
  itemId: string,
  platform: EconomyPlatform
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [item] = await db
    .select()
    .from(shopItems)
    .where(eq(shopItems.id, itemId))
    .limit(1);
  if (!item || !item.active) return { ok: false, error: "item_not_found" };
  if (item.kind !== "extra_spin")
    return { ok: false, error: "item_not_found" };

  if (item.stockTotal != null && item.stockSold >= item.stockTotal) {
    return { ok: false, error: "out_of_stock" };
  }

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

  const [stockRow] = await db
    .update(shopItems)
    .set({ stockSold: sql`${shopItems.stockSold} + 1` })
    .where(
      and(
        eq(shopItems.id, itemId),
        or(isNull(shopItems.stockTotal), lt(shopItems.stockSold, shopItems.stockTotal))
      )
    )
    .returning({ id: shopItems.id });

  if (!stockRow) {
    await applyCredit({
      userId,
      amount: item.priceCoins,
      idempotencyKey: `${idem}:refund_oos`,
      kind: "admin",
      platform,
      referenceType: "shop_stock_race",
      referenceId: itemId,
    });
    return { ok: false, error: "out_of_stock" };
  }

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

  return { ok: true };
}
