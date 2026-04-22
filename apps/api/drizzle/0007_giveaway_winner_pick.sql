-- Режим выбора победителей: случайный или заранее заданный список user id (публично не раскрывается до розыгрыша).
ALTER TABLE "giveaways" ADD COLUMN IF NOT EXISTS "winner_pick_mode" text NOT NULL DEFAULT 'random';
ALTER TABLE "giveaways" ADD COLUMN IF NOT EXISTS "predetermined_winner_user_ids" jsonb;
