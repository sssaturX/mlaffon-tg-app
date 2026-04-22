import { parseMediaImageUploadResponse, type MediaImageUploadResponse } from "shared";
import { api } from "../api";

export type ShopItemMeta = {
  spins?: number;
  subtitle?: string | null;
  badgeText?: string | null;
  buttonLabel?: string | null;
  sortOrder?: number;
  /** Витрина в админке: twitch | kick; без поля — обе. */
  platform?: "twitch" | "kick";
};

export type ShopItem = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  imageMedia?: MediaImageUploadResponse | null;
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

/** Как главная (FAQ): редко меняется, держим в кэше дольше. */
export const SHOP_STALE_TIME_MS = 1000 * 60 * 30;
export const SHOP_GC_TIME_MS = 1000 * 60 * 60;

function normalizeMeta(raw: unknown): ShopItemMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const platformRaw = row.platform;
  const platform =
    platformRaw === "twitch" || platformRaw === "kick" ? platformRaw : undefined;
  return {
    spins: typeof row.spins === "number" ? row.spins : undefined,
    subtitle: typeof row.subtitle === "string" ? row.subtitle : null,
    badgeText: typeof row.badgeText === "string" ? row.badgeText : null,
    buttonLabel: typeof row.buttonLabel === "string" ? row.buttonLabel : null,
    sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : undefined,
    platform,
  };
}

function normalizeShopItemRow(raw: unknown): ShopItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : null;
  if (!id) return null;
  const title = typeof row.title === "string" ? row.title : "Товар";
  const description =
    typeof row.description === "string" ? row.description : null;
  const imageUrl = typeof row.imageUrl === "string" ? row.imageUrl : null;
  const imageMedia = parseMediaImageUploadResponse(row.imageMedia);
  const kind = typeof row.kind === "string" ? row.kind : "";
  let priceCoins = 0;
  if (typeof row.priceCoins === "number" && Number.isFinite(row.priceCoins)) {
    priceCoins = Math.max(0, Math.floor(row.priceCoins));
  }
  let stockRemaining: number | null = null;
  if (row.stockRemaining == null) {
    stockRemaining = null;
  } else if (typeof row.stockRemaining === "number" && Number.isFinite(row.stockRemaining)) {
    stockRemaining = Math.max(0, Math.floor(row.stockRemaining));
  }
  return {
    id,
    title,
    description,
    imageUrl,
    ...(imageMedia ? { imageMedia } : {}),
    kind,
    priceCoins,
    meta: normalizeMeta(row.meta),
    stockRemaining,
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

export type ShopClientPlatform = "twitch" | "kick";

export async function fetchShopPage(
  platform: ShopClientPlatform
): Promise<ShopPagePayload> {
  const q = new URLSearchParams({ platform });
  const r = await api<ShopPagePayload>(`/api/v1/shop/items?${q.toString()}`, {
    httpCache: "default",
  });
  if (!r.ok) throw new Error("shop_load");
  const rawItems = Array.isArray(r.data.items) ? r.data.items : [];
  const items = rawItems
    .map((item) => normalizeShopItemRow(item))
    .filter((row): row is ShopItem => row != null);
  return {
    items,
    globalCopy: normalizeGlobalCopy(r.data.globalCopy),
  };
}
