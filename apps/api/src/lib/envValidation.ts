import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TOKENS_ENCRYPTION_KEY: z.string().min(1, "TOKENS_ENCRYPTION_KEY is required"),
  PORT: z.string().optional().default("3001"),
  HOST: z.string().optional().default("0.0.0.0"),
  NODE_ENV: z.enum(["production", "development", "test"]).optional().default("development"),
});

const prodEnvSchema = z.object({
  CORS_ORIGINS: z.string().min(1, "CORS_ORIGINS required in production").optional(),
  PUBLIC_WEB_URL: z.string().url("PUBLIC_WEB_URL must be a valid URL").optional(),
}).refine(
  (d) => d.CORS_ORIGINS || d.PUBLIC_WEB_URL,
  { message: "Production requires CORS_ORIGINS or PUBLIC_WEB_URL" }
);

/**
 * Validate env vars at startup. Fail-fast if required vars are missing.
 */
export function validateEnv(): void {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`\n❌ Environment validation failed:\n${errors}\n`);
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production") {
    const prodResult = prodEnvSchema.safeParse(process.env);
    if (!prodResult.success) {
      const errors = prodResult.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      console.error(`\n❌ Production environment validation failed:\n${errors}\n`);
      process.exit(1);
    }
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEV_AUTH === "1"
  ) {
    console.error("\n❌ ALLOW_DEV_AUTH=1 is not allowed in production\n");
    process.exit(1);
  }

  if (
    process.env.JWT_SECRET === "dev-only-change-me" &&
    process.env.NODE_ENV === "production"
  ) {
    console.error("\n❌ JWT_SECRET must be changed from default in production\n");
    process.exit(1);
  }
}
