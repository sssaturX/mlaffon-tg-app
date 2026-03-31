import { defineConfig, devices } from "@playwright/test";

/**
 * Запуск: поднять API + web (`npm run dev`), затем `npm run test:e2e -w web`.
 * Базовый URL: `PLAYWRIGHT_BASE_URL` или http://127.0.0.1:5173
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
