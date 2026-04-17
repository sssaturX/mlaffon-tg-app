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

export type ShopGlobalCopy = {
  notice: string;
  warning: string;
};

export type ShopPagePayload = {
  items: ShopItem[];
  globalCopy: ShopGlobalCopy;
};

export const SHOP_STALE_TIME_MS = 1000 * 60 * 2;

function normalizeMeta(raw: unknown): ShopItemMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return {
    spins: typeof row.spins === "number" ? row.spins : undefined,
    subtitle: typeof row.subtitle === "string" ? row.subtitle : null,
    badgeText: typeof row.badgeText === "string" ? row.badgeText : null,
    buttonLabel: typeof row.buttonLabel === "string" ? row.buttonLabel : null,
    sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : undefined,
  };
}

function normalizeGlobalCopy(raw: unknown): ShopGlobalCopy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      notice: "",
      warning: "",
    };
  }
  const o = raw as Record<string, unknown>;
  return {
    notice: typeof o.notice === "string" ? o.notice : "",
    warning: typeof o.warning === "string" ? o.warning : "",
  };
}

export async function fetchShopPage(): Promise<ShopPagePayload> {
  const r = await api<ShopPagePayload>("/api/v1/shop/items", {
    httpCache: "default",
  });
  if (!r.ok) throw new Error("shop_load");
  const items = (r.data.items ?? []).map((item) => ({
    ...item,
    meta: normalizeMeta(item.meta),
  }));
  return {
    items,
    globalCopy: normalizeGlobalCopy(r.data.globalCopy),
  };
}
