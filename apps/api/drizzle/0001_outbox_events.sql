-- Outbox для broadcast realtime (см. services/outboxFlush.ts, services/realtimePublish.ts)
CREATE TABLE IF NOT EXISTS "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" jsonb NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_created_idx" ON "outbox_events" ("created_at");
