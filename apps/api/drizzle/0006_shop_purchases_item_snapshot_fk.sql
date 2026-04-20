-- Снимок названия товара для истории покупок после удаления карточки из каталога.
ALTER TABLE "shop_purchases" ADD COLUMN IF NOT EXISTS "item_title_snapshot" text NOT NULL DEFAULT '';

UPDATE "shop_purchases" AS p
SET "item_title_snapshot" = i."title"
FROM "shop_items" AS i
WHERE p."shop_item_id" = i."id" AND trim(p."item_title_snapshot") = '';

ALTER TABLE "shop_purchases" DROP CONSTRAINT IF EXISTS "shop_purchases_shop_item_id_fkey";

ALTER TABLE "shop_purchases" ALTER COLUMN "shop_item_id" DROP NOT NULL;

ALTER TABLE "shop_purchases"
  ADD CONSTRAINT "shop_purchases_shop_item_id_fkey"
  FOREIGN KEY ("shop_item_id") REFERENCES "shop_items"("id") ON DELETE SET NULL;
