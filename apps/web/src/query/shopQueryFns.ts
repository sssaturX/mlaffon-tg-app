import { api } from "../api";

export type ShopItemMeta = {
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

export async function fetchShopItems(): Promise<ShopItem[]> {
  const r = await api<{ items: ShopItem[] }>("/api/v1/shop/items", {
    httpCache: "default",
  });
  if (!r.ok) throw new Error("shop_load");
  return r.data.items;
}
