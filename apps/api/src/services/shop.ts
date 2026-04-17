import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { shopItems, shopPurchases, userInventory } from "../db/schema.js";
import { applyCredit, applyDebit, type EconomyPlatform } from "./economy.js";
import { getShopGlobalCopyForClient } from "./shopSettings.js";
import { nanoid } from "nanoid";

/** Платформа витрины магазина (совпадает с переключателем Twitch/Kick в приложении). */
export type ShopClientPlatform = "twitch" | "kick";

export function shopItemVisibleForPlatform(
  meta: unknown,
  platform: ShopClientPlatform
): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return true;
  const p = (meta as Record<string, unknown>).platform;
  if (p === "twitch" || p === "kick") return p === platform;
  return true;
}

export type ShopItemClientDto = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  kind: string;
  priceCoins: number;
  meta: unknown;
  /** null — без лимита; 0 — закончилось. */
  stockRemaining: number | null;
};

export async function listShopItemsForClient(
  platform: ShopClientPlatform
): Promise<ShopItemClientDto[]> {
  const rows = await db.select().from(shopItems).where(eq(shopItems.active, true));
  const mapped = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    imageUrl: r.imageUrl ?? null,
    kind: r.kind,
    priceCoins: r.priceCoins,
    meta: r.meta ?? null,
    stockRemaining:
      r.stockTotal == null ? null : Math.max(0, r.stockTotal - r.stockSold),
  }));
  const visible = mapped.filter((row) =>
    shopItemVisibleForPlatform(row.meta, platform)
  );
  return visible.sort((a, b) => {
    const aOrder =
      typeof (a.meta as { sortOrder?: unknown } | null)?.sortOrder === "number"
        ? ((a.meta as { sortOrder?: number } | null)?.sortOrder ?? 0)
        : 0;
    const bOrder =
      typeof (b.meta as { sortOrder?: unknown } | null)?.sortOrder === "number"
        ? ((b.meta as { sortOrder?: number } | null)?.sortOrder ?? 0)
        : 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.id.localeCompare(b.id);
  });
}

export async function getShopClientBundle(platform: ShopClientPlatform): Promise<{
  items: ShopItemClientDto[];
  globalCopy: Awaited<ReturnType<typeof getShopGlobalCopyForClient>>;
}> {
  const [items, globalCopy] = await Promise.all([
    listShopItemsForClient(platform),
    getShopGlobalCopyForClient(),
  ]);
  return { items, globalCopy };
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
  if (item.kind !== "extra_spin" && item.kind !== "manual_fulfillment") {
    return { ok: false, error: "item_not_found" };
  }

  if (!shopItemVisibleForPlatform(item.meta, platform)) {
    return { ok: false, error: "item_not_found" };
  }

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

  if (item.kind === "extra_spin") {
    const qty = (item.meta as { spins?: number } | null)?.spins ?? 1;
    await db
      .insert(userInventory)
      .values({
        userId,
        itemId: item.id,
        quantity: qty,
      })
      .onConflictDoUpdate({
        target: [userInventory.userId, userInventory.itemId],
        set: {
          quantity: sql`${userInventory.quantity} + ${qty}`,
          updatedAt: sql`now()`,
        },
      });
  }

  await db.insert(shopPurchases).values({
    userId,
    shopItemId: item.id,
    priceCoins: item.priceCoins,
    platform,
  });

  return { ok: true };
}
