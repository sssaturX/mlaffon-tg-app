import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { telegramLiveNotifySubscribers } from "../db/schema.js";

export async function upsertLiveNotifySubscriber(params: {
  telegramUserId: bigint;
  chatId: bigint;
}): Promise<void> {
  await db
    .insert(telegramLiveNotifySubscribers)
    .values({
      telegramUserId: params.telegramUserId,
      chatId: params.chatId,
      active: true,
    })
    .onConflictDoUpdate({
      target: telegramLiveNotifySubscribers.telegramUserId,
      set: {
        chatId: params.chatId,
        active: true,
        updatedAt: sql`now()`,
      },
    });
}

export async function setLiveNotifySubscriberActive(
  telegramUserId: bigint,
  active: boolean
): Promise<void> {
  await db
    .update(telegramLiveNotifySubscribers)
    .set({ active, updatedAt: sql`now()` })
    .where(eq(telegramLiveNotifySubscribers.telegramUserId, telegramUserId));
}

export async function deactivateLiveNotifyByChatId(chatId: bigint): Promise<void> {
  await db
    .update(telegramLiveNotifySubscribers)
    .set({ active: false, updatedAt: sql`now()` })
    .where(eq(telegramLiveNotifySubscribers.chatId, chatId));
}

export async function listActiveLiveNotifyChatIds(): Promise<bigint[]> {
  const rows = await db
    .select({ chatId: telegramLiveNotifySubscribers.chatId })
    .from(telegramLiveNotifySubscribers)
    .where(eq(telegramLiveNotifySubscribers.active, true));
  return rows.map((r) => r.chatId);
}
