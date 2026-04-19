/**
 * Одноразово: у всех товаров магазина убрать картинки (image_url + meta.imageMedia),
 * чтобы витрина не тянула тяжёлые URL; потом загрузить заново через админку (CDN).
 *
 * Запуск (из apps/api): npx tsx src/scripts/clearShopItemImages.ts
 */
import "dotenv/config";
import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://mlaffon:mlaffon@localhost:5432/mlaffon";

const pool = new pg.Pool({ connectionString });

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
  console.log(`clearShopItemImages: обновлено строк: ${r.rowCount ?? 0}`);
} finally {
  await pool.end();
}
