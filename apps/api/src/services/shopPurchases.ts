import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { shopItems, shopPurchases, users } from "../db/schema.js";

export type AdminShopPurchaseRow = {
  id: string;
  createdAt: string;
  /** `null`, если карточку товара удалили из каталога (название в `itemTitle`). */
  shopItemId: string | null;
  itemTitle: string;
  priceCoins: number;
  platform: string;
  userId: string;
  telegramId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  telegramChatLink: string | null;
};

export async function listShopPurchasesAdmin(opts: {
  itemId?: string;
  limit: number;
}): Promise<AdminShopPurchaseRow[]> {
  const limit = Math.min(Math.max(opts.limit, 1), 500);
  const filters: SQL[] = [];
  if (opts.itemId) filters.push(eq(shopPurchases.shopItemId, opts.itemId));

  const rows = await db
    .select({
      id: shopPurchases.id,
      createdAt: shopPurchases.createdAt,
      shopItemId: shopPurchases.shopItemId,
      priceCoins: shopPurchases.priceCoins,
      platform: shopPurchases.platform,
      userId: shopPurchases.userId,
      telegramId: users.telegramId,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      itemTitle: sql<string>`COALESCE(${shopItems.title}, NULLIF(TRIM(${shopPurchases.itemTitleSnapshot}), ''), '—')`,
    })
    .from(shopPurchases)
    .innerJoin(users, eq(users.id, shopPurchases.userId))
    .leftJoin(shopItems, eq(shopItems.id, shopPurchases.shopItemId))
    .where(filters.length ? and(...filters) : sql`true`)
    .orderBy(desc(shopPurchases.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const rawU = r.username?.trim();
    const uname = rawU?.replace(/^@+/, "") || null;
    const telegramChatLink = uname
      ? `https://t.me/${uname}`
      : r.telegramId != null
        ? `tg://user?id=${r.telegramId}`
        : null;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      shopItemId: r.shopItemId,
      itemTitle: r.itemTitle,
      priceCoins: r.priceCoins,
      platform: r.platform,
      userId: r.userId,
      telegramId: r.telegramId != null ? String(r.telegramId) : null,
      username: r.username,
      firstName: r.firstName,
      lastName: r.lastName,
      telegramChatLink,
    };
  });
}
