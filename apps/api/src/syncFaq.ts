/**
 * Слияние FAQ из `faqDefault.ts` в `app_settings` (ключ `faq`).
 * Вызывается из `deploy/redeploy.sh` после `db:push`, чтобы витрина FAQ обновлялась
 * даже при `DEPLOY_DB_SEED=0`.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { appSettings } from "./db/schema.js";
import { mergeFaqDbWithDefaults } from "./content/faqDefault.js";

async function main() {
  const [faqRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "faq"))
    .limit(1);
  const faqItems = mergeFaqDbWithDefaults(faqRow?.value);
  if (!faqRow) {
    await db.insert(appSettings).values({
      key: "faq",
      value: { items: faqItems },
    });
    console.log("sync-faq: создана запись app_settings.faq");
  } else {
    await db
      .update(appSettings)
      .set({
        value: { items: faqItems },
        updatedAt: new Date(),
      })
      .where(eq(appSettings.key, "faq"));
    console.log("sync-faq: обновлена app_settings.faq (дефолты + кастомные вопросы)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
