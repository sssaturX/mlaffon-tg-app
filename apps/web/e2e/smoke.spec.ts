import { test, expect } from "@playwright/test";

test("страница приложения открывается", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
