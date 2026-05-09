import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  shopItems,
  shopPurchases,
  transactions,
  userBalances,
  userInventory,
  users,
} from "../db/schema.js";
import {
  publishBalanceUpdate,
  publishObsWidgetEvent,
} from "./realtimePublish.js";
import { getShopGlobalCopyForClient } from "./shopSettings.js";
import { nanoid } from "nanoid";
import type { MediaImageUploadResponse } from "shared";
import { parseStoredMediaImage } from "../lib/mediaImageJson.js";
import { singleFlight } from "../lib/singleFlight.js";
import {
  shopBundleCacheTotal,
  shopBundlePhaseSeconds,
} from "../lib/metrics.js";
import {
  getShopBundleFromCache,
  invalidateShopBundleCache,
  setShopBundleCache,
} from "./shopBundleCache.js";
import { getActiveLiveBroadcast } from "./liveBroadcast.js";
import {
  getObsPurchaseWidgetSettings,
  normalizeBuyerMessage,
  type ObsPurchaseAlertEvent,
} from "./obsPurchaseWidget.js";

export type ShopClientPlatform = "twitch" | "kick";
export type EconomyPlatform = "twitch" | "kick";

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
  imageMedia?: MediaImageUploadResponse | null;
  kind: string;
  priceCoins: number;
  meta: unknown;
  stockRemaining: number | null;
};

export async function listShopItemsForClient(
  platform: ShopClientPlatform
): Promise<ShopItemClientDto[]> {
  const rows = await db.select().from(shopItems).where(eq(shopItems.active, true));
  const mapped = rows.map((r) => {
    const meta = r.meta ?? null;
    const imageMedia =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? parseStoredMediaImage(
            (meta as Record<string, unknown>).imageMedia
          )
        : null;
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      imageUrl: r.imageUrl ?? null,
      ...(imageMedia ? { imageMedia } : {}),
      kind: r.kind,
      priceCoins: r.priceCoins,
      meta,
      stockRemaining:
        r.stockTotal == null ? null : Math.max(0, r.stockTotal - r.stockSold),
    };
  });
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

function observeShopBundleTotalInner(
  platform: ShopClientPlatform,
  tInner: number
): void {
  const sec = (performance.now() - tInner) / 1000;
  shopBundlePhaseSeconds.observe({ platform, phase: "total_inner" }, sec);
  if (sec > 0.5) {
    console.warn(
      `[shop] slow getShopClientBundle platform=${platform} ${(sec * 1000).toFixed(0)}ms`
    );
  }
}

export async function getShopClientBundle(platform: ShopClientPlatform): Promise<{
  items: ShopItemClientDto[];
  globalCopy: Awaited<ReturnType<typeof getShopGlobalCopyForClient>>;
}> {
  const tInner = performance.now();
  const tRedis0 = performance.now();
  const cached = await getShopBundleFromCache(platform);
  shopBundlePhaseSeconds.observe(
    { platform, phase: "redis_read" },
    (performance.now() - tRedis0) / 1000
  );
  if (cached) {
    shopBundleCacheTotal.inc({ result: "hit", platform });
    observeShopBundleTotalInner(platform, tInner);
    return {
      items: cached.items as ShopItemClientDto[],
      globalCopy: cached.globalCopy,
    };
  }
  shopBundleCacheTotal.inc({ result: "miss", platform });
  const bundle = await singleFlight(`shop:bundle:load:${platform}`, async () => {
    const tInFlight = performance.now();
    const again0 = performance.now();
    const again = await getShopBundleFromCache(platform);
    shopBundlePhaseSeconds.observe(
      { platform, phase: "redis_read" },
      (performance.now() - again0) / 1000
    );
    if (again) {
      shopBundleCacheTotal.inc({ result: "hit", platform });
      return {
        items: again.items as ShopItemClientDto[],
        globalCopy: again.globalCopy,
      };
    }
    const tDb0 = performance.now();
    const [items, globalCopy] = await Promise.all([
      listShopItemsForClient(platform),
      getShopGlobalCopyForClient(),
    ]);
    shopBundlePhaseSeconds.observe(
      { platform, phase: "rebuild_db_parallel" },
      (performance.now() - tDb0) / 1000
    );
    const built = { items, globalCopy };
    const tSet0 = performance.now();
    await setShopBundleCache(platform, {
      items: built.items as unknown[],
      globalCopy: built.globalCopy,
    });
    shopBundlePhaseSeconds.observe(
      { platform, phase: "cache_write" },
      (performance.now() - tSet0) / 1000
    );
    shopBundlePhaseSeconds.observe(
      { platform, phase: "singleflight_worker" },
      (performance.now() - tInFlight) / 1000
    );
    return built;
  });
  observeShopBundleTotalInner(platform, tInner);
  return bundle;
}

/**
 * Atomic purchase: debit + stock decrement + inventory + purchase record
 * all happen inside a single DB transaction. No partial state possible.
 */
export async function purchaseItem(
  userId: string,
  itemId: string,
  platform: EconomyPlatform,
  buyerMessageRaw?: string | null
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
  const buyerMessage = normalizeBuyerMessage(buyerMessageRaw);

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, idem))
      .limit(1);
    if (existing) return { ok: false as const, error: "duplicate" };

    const platformCol = platform === "twitch" ? "twitchCoins" : "kickCoins";
    const [bal] = await tx
      .select({
        coins: userBalances.coins,
        twitchCoins: userBalances.twitchCoins,
        kickCoins: userBalances.kickCoins,
      })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);

    const platformBal = platform === "twitch" ? bal?.twitchCoins : bal?.kickCoins;
    if (!bal || (platformBal ?? 0) < item.priceCoins)
      return { ok: false as const, error: "insufficient_coins" };

    await tx.insert(transactions).values({
      userId,
      amount: -item.priceCoins,
      kind: "shop_purchase",
      referenceType: "shop_item",
      referenceId: itemId,
      idempotencyKey: idem,
      meta: { platform },
    });

    if (platform === "twitch") {
      await tx
        .update(userBalances)
        .set({
          twitchCoins: sql`${userBalances.twitchCoins} - ${item.priceCoins}`,
          coins: sql`${userBalances.coins} - ${item.priceCoins}`,
        })
        .where(eq(userBalances.userId, userId));
    } else {
      await tx
        .update(userBalances)
        .set({
          kickCoins: sql`${userBalances.kickCoins} - ${item.priceCoins}`,
          coins: sql`${userBalances.coins} - ${item.priceCoins}`,
        })
        .where(eq(userBalances.userId, userId));
    }

    const [stockRow] = await tx
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
      throw new Error("out_of_stock_race");
    }

    if (item.kind === "extra_spin") {
      const qty = (item.meta as { spins?: number } | null)?.spins ?? 1;
      await tx
        .insert(userInventory)
        .values({ userId, itemId: item.id, quantity: qty })
        .onConflictDoUpdate({
          target: [userInventory.userId, userInventory.itemId],
          set: {
            quantity: sql`${userInventory.quantity} + ${qty}`,
            updatedAt: sql`now()`,
          },
        });
    }

    const [purchase] = await tx.insert(shopPurchases).values({
      userId,
      shopItemId: item.id,
      itemTitleSnapshot: item.title,
      buyerMessage,
      priceCoins: item.priceCoins,
      platform,
    }).returning({
      id: shopPurchases.id,
      createdAt: shopPurchases.createdAt,
    });

    return {
      ok: true as const,
      purchaseId: purchase?.id ?? "",
      createdAt: purchase?.createdAt ?? new Date(),
    };
  }).catch((e: Error) => {
    if (e.message === "out_of_stock_race") {
      return { ok: false as const, error: "out_of_stock" };
    }
    throw e;
  });

  if (result.ok) {
    void publishBalanceUpdate(userId);
    invalidateShopBundleCache();
    void publishPurchaseAlert({
      userId,
      item: {
        title: item.title,
        imageUrl: item.imageUrl,
        priceCoins: item.priceCoins,
        meta: item.meta,
      },
      platform,
      buyerMessage,
      createdAt: result.createdAt,
    });
  }
  return result;
}

async function publishPurchaseAlert(input: {
  userId: string;
  item: {
    title: string;
    imageUrl: string | null;
    priceCoins: number;
    meta: unknown;
  };
  platform: EconomyPlatform;
  buyerMessage: string | null;
  createdAt: Date;
}): Promise<void> {
  const [buyer, activeLive, settings] = await Promise.all([
    db
      .select({
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1),
    getActiveLiveBroadcast(),
    getObsPurchaseWidgetSettings(),
  ]);

  const user = buyer[0];
  const username = user?.username?.trim().replace(/^@+/, "") || null;
  const fullName = [user?.firstName, user?.lastName]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" ");
  const buyerName = fullName || (username ? `@${username}` : "Покупатель");
  const media =
    input.item.meta && typeof input.item.meta === "object" && !Array.isArray(input.item.meta)
      ? parseStoredMediaImage((input.item.meta as Record<string, unknown>).imageMedia)
      : null;
  const streamPlatform =
    activeLive?.platform === "kick" || activeLive?.platform === "twitch"
      ? activeLive.platform
      : input.platform;

  const event: ObsPurchaseAlertEvent = {
    type: "purchase_alert",
    v: 1,
    data: {
      buyerName,
      buyerUsername: username,
      productName: input.item.title,
      productImage: media?.fallbackSrc ?? input.item.imageUrl ?? null,
      price: input.item.priceCoins,
      currency: input.platform === "twitch" ? "Twitch coins" : "Kick coins",
      buyerMessage: input.buyerMessage,
      createdAt: input.createdAt.toISOString(),
      streamerId: settings.streamerId,
      purchasePlatform: input.platform,
      streamPlatform,
    },
  };

  await publishObsWidgetEvent(settings.streamerId, event);
}
