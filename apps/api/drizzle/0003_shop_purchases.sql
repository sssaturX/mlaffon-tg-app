CREATE TABLE IF NOT EXISTS "shop_purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "shop_item_id" text NOT NULL REFERENCES "shop_items"("id") ON DELETE RESTRICT,
  "price_coins" integer NOT NULL,
  "platform" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_purchases_user_idx" ON "shop_purchases" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_purchases_item_idx" ON "shop_purchases" ("shop_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_purchases_created_idx" ON "shop_purchases" ("created_at");
