import { api } from "../api";
import type { ActivePlatform } from "../context/PlatformContext";

export type ShopItemMeta = {
  platform?: ActivePlatform | "both";
  spins?: number;
  subtitle?: string | null;
  badgeText?: string | null;
  buttonLabel?: string | null;
  sortOrder?: number;
};

export type ShopItem = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  kind: string;
  priceCoins: number;
  meta: ShopItemMeta | null;
  stockRemaining: number | null;
};

export const SHOP_STALE_TIME_MS = 1000 * 60 * 2;

function normalizeMeta(raw: unknown): ShopItemMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const platform = row.platform;
  return {
    platform:
      platform === "twitch" || platform === "kick" || platform === "both"
        ? platform
        : "both",
    spins: typeof row.spins === "number" ? row.spins : undefined,
    subtitle: typeof row.subtitle === "string" ? row.subtitle : null,
    badgeText: typeof row.badgeText === "string" ? row.badgeText : null,
    buttonLabel: typeof row.buttonLabel === "string" ? row.buttonLabel : null,
    sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : undefined,
  };
}

export async function fetchShopItems(
  platform: ActivePlatform
): Promise<ShopItem[]> {
  const q = new URLSearchParams({ platform });
  const r = await api<{ items: ShopItem[] }>(`/api/v1/shop/items?${q.toString()}`, {
    httpCache: "default",
  });
  if (!r.ok) throw new Error("shop_load");
  return (r.data.items ?? []).map((item) => ({
    ...item,
    meta: normalizeMeta(item.meta),
  }));
}
