/**
 * Одноразово: у всех товаров магазина убрать картинки (image_url + meta.imageMedia),
 * чтобы витрина не тянула тяжёлые данные; потом загрузить заново через админку.
 *
 * Запуск локально (из apps/api, с DATABASE_URL в окружении):
 *   npx tsx src/scripts/clearShopItemImages.ts
 *
 * На сервере (после деплоя, с env из shared):
 *   set -a && . /opt/mlaffon/shared/env && set +a && cd /opt/mlaffon/current/apps/api && node dist/scripts/clearShopItemImages.js
 *   или из исходников: npm run db:clear-shop-images
 */
import "dotenv/config";
import { Redis } from "ioredis";
import pg from "pg";

const SHOP_BUNDLE_KEYS = [
  "mlaffon:shop:bundle:v1:twitch",
  "mlaffon:shop:bundle:v1:kick",
];

const connectionString =
  process.env.DATABASE_URL ?? "postgres://mlaffon:mlaffon@localhost:5432/mlaffon";

const pool = new pg.Pool({ connectionString });

async function invalidateShopBundleRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log("clearShopItemImages: REDIS_URL не задан — пропуск сброса кэша витрины");
    return;
  }
  const r = new Redis(url, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    commandTimeout: 5000,
  });
  try {
    const n = await r.del(...SHOP_BUNDLE_KEYS);
    console.log(`clearShopItemImages: сброшено ключей Redis витрины: ${n}`);
  } finally {
    await r.quit();
  }
}

try {
  const r = await pool.query(`
    UPDATE shop_items
    SET
      image_url = NULL,
      meta = CASE
        WHEN meta IS NULL THEN NULL
        ELSE meta::jsonb - 'imageMedia'
      END
  `);
  console.log(`clearShopItemImages: обновлено строк в shop_items: ${r.rowCount ?? 0}`);
  await invalidateShopBundleRedis();
} finally {
  await pool.end();
}
