import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings } from "../db/schema.js";
import { invalidateShopBundleCache } from "./shopBundleCache.js";

const SHOP_GLOBAL_COPY_KEY = "shop_global_copy";

export type ShopGlobalCopyDto = {
  notice: string;
  warning: string;
};

const DEFAULT_SHOP_GLOBAL_COPY: ShopGlobalCopyDto = {
  notice:
    "После покупки вы получите кнопку для связи с менеджером (@MaloyGiftSupport).",
  warning:
    "Это единственный аккаунт, который занимается выдачей призов. Остальные — мошенники.",
};

export function normalizeShopGlobalCopy(raw: unknown): ShopGlobalCopyDto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SHOP_GLOBAL_COPY };
  }
  const o = raw as Record<string, unknown>;
  const notice =
    typeof o.notice === "string" && o.notice.trim()
      ? o.notice.trim()
      : DEFAULT_SHOP_GLOBAL_COPY.notice;
  const warning =
    typeof o.warning === "string" && o.warning.trim()
      ? o.warning.trim()
      : DEFAULT_SHOP_GLOBAL_COPY.warning;
  return { notice, warning };
}

export async function getShopGlobalCopyForClient(): Promise<ShopGlobalCopyDto> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SHOP_GLOBAL_COPY_KEY))
    .limit(1);
  return normalizeShopGlobalCopy(row?.value);
}

export async function setShopGlobalCopyAdmin(
  value: ShopGlobalCopyDto
): Promise<void> {
  await db
    .insert(appSettings)
    .values({
      key: SHOP_GLOBAL_COPY_KEY,
      value,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: sql`now()` },
    });
  invalidateShopBundleCache();
}
