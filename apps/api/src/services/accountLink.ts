import crypto from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accountLinkTokens, userBalances, users } from "../db/schema.js";
import type { TelegramUserPayload } from "../lib/telegram.js";
import {
  mergeUserIntoSurvivorTx,
  pickSurvivorByProgress,
  zeroBalance,
} from "./mergeUsers.js";

const LINK_TTL_MS = 20 * 60 * 1000;

export class LinkTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LinkTokenError";
  }
}

export async function createTelegramLinkToken(userId: string): Promise<{
  token: string;
  expiresAt: string;
  botStartUrl: string;
}> {
  const token = crypto.randomBytes(18).toString("hex");
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await db.insert(accountLinkTokens).values({
    userId,
    token,
    expiresAt,
  });
  const bot = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? "YOUR_BOT";
  /** `startapp` открывает Mini App с `start_param` в initData; `start` ведёт в чат с ботом. */
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    botStartUrl: `https://t.me/${bot}?startapp=link_${token}`,
  };
}

/**
 * Привязка Telegram к веб-аккаунту по одноразовому токену из start_param.
 */
export async function linkTelegramFromToken(
  secret: string,
  telegramId: bigint,
  tg: TelegramUserPayload
): Promise<{ userId: string; created: boolean; accountsMerged?: boolean }> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(accountLinkTokens)
    .where(
      and(
        eq(accountLinkTokens.token, secret),
        isNull(accountLinkTokens.usedAt),
        gt(accountLinkTokens.expiresAt, now)
      )
    )
    .limit(1);

  if (!row) {
    throw new LinkTokenError(
      "invalid_or_expired_link",
      "Ссылка недействительна или истекла. Создайте новую в профиле на сайте."
    );
  }

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!target) {
    throw new LinkTokenError("invalid_or_expired_link", "Пользователь не найден.");
  }

  const [other] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  if (target.telegramId != null && target.telegramId !== telegramId) {
    throw new LinkTokenError(
      "account_already_linked",
      "К этому профилю уже привязан другой Telegram."
    );
  }

  if (other && other.id !== target.id) {
    const [balTarget] = await db
      .select()
      .from(userBalances)
      .where(eq(userBalances.userId, target.id))
      .limit(1);
    const [balOther] = await db
      .select()
      .from(userBalances)
      .where(eq(userBalances.userId, other.id))
      .limit(1);
    const { survivorId, loserId } = pickSurvivorByProgress(
      target,
      other,
      balTarget ?? zeroBalance(target.id),
      balOther ?? zeroBalance(other.id)
    );

    const profileBase = survivorId === target.id ? target : other;

    await db.transaction(async (tx) => {
      await tx
        .update(accountLinkTokens)
        .set({ userId: survivorId })
        .where(eq(accountLinkTokens.id, row.id));

      await mergeUserIntoSurvivorTx(tx, survivorId, loserId);

      await tx
        .update(users)
        .set({
          telegramId,
          username: tg.username ?? profileBase.username,
          firstName: tg.first_name ?? profileBase.firstName,
          lastName: tg.last_name ?? profileBase.lastName,
          photoUrl: tg.photo_url ?? profileBase.photoUrl,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, survivorId));

      await tx
        .update(accountLinkTokens)
        .set({ usedAt: now })
        .where(eq(accountLinkTokens.id, row.id));
    });

    return { userId: survivorId, created: false, accountsMerged: true };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        telegramId,
        username: tg.username ?? target.username,
        firstName: tg.first_name ?? target.firstName,
        lastName: tg.last_name ?? target.lastName,
        photoUrl: tg.photo_url ?? target.photoUrl,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, target.id));

    await tx
      .update(accountLinkTokens)
      .set({ usedAt: now })
      .where(eq(accountLinkTokens.id, row.id));
  });

  return { userId: target.id, created: false };
}
