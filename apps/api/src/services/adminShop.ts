import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { shopItems } from "../db/schema.js";
import { invalidateShopBundleCache } from "./shopBundleCache.js";

export type AdminShopItemRow = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  kind: string;
  priceCoins: number;
  meta: unknown;
  active: boolean;
  stockTotal: number | null;
  stockSold: number;
};

export async function listShopItemsAdmin(): Promise<AdminShopItemRow[]> {
  const rows = await db.select().from(shopItems).orderBy(asc(shopItems.id));
  const mapped = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    imageUrl: r.imageUrl ?? null,
    kind: r.kind,
    priceCoins: r.priceCoins,
    meta: r.meta ?? null,
    active: r.active,
    stockTotal: r.stockTotal ?? null,
    stockSold: r.stockSold,
  }));
  return mapped.sort((a, b) => {
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

export async function createShopItemAdmin(input: {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  kind: string;
  priceCoins: number;
  meta: unknown;
  active: boolean;
  stockTotal: number | null;
}): Promise<void> {
  await db.insert(shopItems).values({
    id: input.id,
    title: input.title,
    description: input.description,
    imageUrl: input.imageUrl,
    kind: input.kind,
    priceCoins: input.priceCoins,
    meta: input.meta as object | null,
    active: input.active,
    stockTotal: input.stockTotal,
    stockSold: 0,
  });
  invalidateShopBundleCache();
}

export async function updateShopItemAdmin(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    kind?: string;
    priceCoins?: number;
    meta?: unknown;
    active?: boolean;
    stockTotal?: number | null;
    stockSold?: number;
  }
): Promise<boolean> {
  const [cur] = await db.select().from(shopItems).where(eq(shopItems.id, id)).limit(1);
  if (!cur) return false;

  if (
    typeof patch.stockTotal === "number" &&
    patch.stockTotal < cur.stockSold
  ) {
    throw new Error("stock_total_below_sold");
  }

  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if ((patch as { imageUrl?: string | null }).imageUrl !== undefined)
    set.imageUrl = (patch as { imageUrl?: string | null }).imageUrl;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.priceCoins !== undefined) set.priceCoins = patch.priceCoins;
  if (patch.meta !== undefined) set.meta = patch.meta;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.stockTotal !== undefined) set.stockTotal = patch.stockTotal;
  if (patch.stockSold !== undefined) set.stockSold = patch.stockSold;

  if (Object.keys(set).length === 0) return true;

  await db
    .update(shopItems)
    .set(set as Partial<typeof shopItems.$inferInsert>)
    .where(eq(shopItems.id, id));
  invalidateShopBundleCache();
  return true;
}

export async function deleteShopItemAdmin(id: string): Promise<boolean> {
  const r = await db.delete(shopItems).where(eq(shopItems.id, id)).returning({ id: shopItems.id });
  if (r.length > 0) invalidateShopBundleCache();
  return r.length > 0;
}
