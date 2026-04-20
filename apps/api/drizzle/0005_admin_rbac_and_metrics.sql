-- Admin accounts table with role-based access control
CREATE TABLE IF NOT EXISTS "admins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "passphrase_hash" text NOT NULL,
  "role" text NOT NULL DEFAULT 'viewer' CHECK ("role" IN ('super_admin', 'moderator', 'viewer')),
  "active" boolean NOT NULL DEFAULT true,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "admins_email_idx" ON "admins" ("email");

-- Add role + request_id to audit log
ALTER TABLE "admin_audit_log" ADD COLUMN IF NOT EXISTS "role" text;
ALTER TABLE "admin_audit_log" ADD COLUMN IF NOT EXISTS "request_id" text;
ALTER TABLE "admin_audit_log" ADD COLUMN IF NOT EXISTS "success" boolean DEFAULT true;

-- Seed default super_admin from env (done in app code, not here)
