ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "stock_total" integer;
--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "stock_sold" integer DEFAULT 0 NOT NULL;
