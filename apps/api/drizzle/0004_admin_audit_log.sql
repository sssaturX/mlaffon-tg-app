CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_email" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "payload" jsonb,
  "ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" ("created_at");
CREATE INDEX "admin_audit_log_action_idx" ON "admin_audit_log" ("action");

-- Partial index for unpublished outbox events (optimizes outbox flush polling)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_events_unpublished_idx"
  ON "outbox_events" ("created_at")
  WHERE "published_at" IS NULL;

-- Index for leaderboard sort columns
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_balances_coins_idx" ON "user_balances" ("coins" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_balances_twitch_coins_idx" ON "user_balances" ("twitch_coins" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_balances_kick_coins_idx" ON "user_balances" ("kick_coins" DESC);

-- Partial index for active giveaways not yet drawn (optimizes finalization query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "giveaways_pending_draw_idx"
  ON "giveaways" ("ends_at")
  WHERE "drawn_at" IS NULL;
