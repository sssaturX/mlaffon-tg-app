import { getRedis } from "../lib/redis.js";
import type { ShopGlobalCopyDto } from "./shopSettings.js";

const PREFIX = "mlaffon:shop:bundle:v2:";
/** Инвалидация при покупке/админке; длинный TTL снижает холодные промахи при стабильной витрине. */
const TTL_SEC = 180;

export type ShopClientBundleCached = {
  items: unknown[];
  globalCopy: ShopGlobalCopyDto;
};

function key(platform: "twitch" | "kick"): string {
  return `${PREFIX}${platform}`;
}

export async function getShopBundleFromCache(
  platform: "twitch" | "kick"
): Promise<ShopClientBundleCached | null> {
  try {
    const raw = await getRedis().get(key(platform));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShopClientBundleCached;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setShopBundleCache(
  platform: "twitch" | "kick",
  bundle: ShopClientBundleCached
): Promise<void> {
  try {
    await getRedis().setex(key(platform), TTL_SEC, JSON.stringify(bundle));
  } catch {
    /* Redis down — только БД */
  }
}

/** Сброс витрины (товары, тексты, остатки после покупки). */
export function invalidateShopBundleCache(): void {
  const r = getRedis();
  void r.del(key("twitch"), key("kick")).catch(() => {});
}
