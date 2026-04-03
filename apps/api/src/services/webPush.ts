import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { pushSubscriptions } from "../db/schema.js";

let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:support@localhost";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  const k = process.env.VAPID_PUBLIC_KEY?.trim();
  return k && k.length > 0 ? k : null;
}

export async function upsertPushSubscription(
  userId: string,
  sub: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    expirationTime?: number | null;
  }
): Promise<void> {
  const { endpoint, keys } = sub;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error("invalid_subscription");
  }
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        updatedAt: new Date(),
      },
    });
}

export async function removePushSubscriptionByEndpoint(
  userId: string,
  endpoint: string
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.userId, userId)
      )
    );
}

const LIVE_PAYLOAD = JSON.stringify({
  title: "Стрим начался 🔴",
  body: "Заходи смотреть прямо сейчас!",
  url: "/stream",
});

type LogLike = { warn: (o: Record<string, unknown>, m: string) => void };

function isGoneStatus(statusCode?: number): boolean {
  return statusCode === 410 || statusCode === 404;
}

/**
 * Рассылка при старте эфира из админки. Без VAPID — no-op.
 */
export async function notifyWebPushLiveStarted(log?: LogLike): Promise<void> {
  if (!getVapidPublicKey()) {
    log?.warn({}, "web_push_skipped_no_vapid");
    return;
  }
  if (!ensureVapidConfigured()) {
    log?.warn({}, "web_push_skipped_no_vapid");
    return;
  }

  const rows = await db.select().from(pushSubscriptions);
  if (rows.length === 0) return;

  await Promise.all(
    rows.map(async (row) => {
      const sub = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webpush.sendNotification(sub, LIVE_PAYLOAD, {
          TTL: 3600,
          urgency: "high",
        });
      } catch (e: unknown) {
        const status =
          e && typeof e === "object" && "statusCode" in e
            ? (e as { statusCode?: number }).statusCode
            : undefined;
        if (isGoneStatus(status)) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, row.endpoint));
          log?.warn({ endpoint: row.endpoint.slice(0, 48) }, "web_push_sub_removed");
          return;
        }
        log?.warn(
          {
            err: e instanceof Error ? e.message : String(e),
            endpoint: row.endpoint.slice(0, 48),
          },
          "web_push_send_failed"
        );
      }
    })
  );
}
