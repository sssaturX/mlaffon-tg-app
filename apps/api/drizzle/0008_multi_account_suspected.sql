ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "multi_account_suspected" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "multi_account_suspected_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "multi_account_shared_users" integer;

CREATE INDEX IF NOT EXISTS "users_multi_account_suspected_idx"
  ON "users" ("multi_account_suspected")
  WHERE "multi_account_suspected" = true;
