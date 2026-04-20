import webpush from "web-push";
import { and, eq, sql } from "drizzle-orm";
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

const BATCH_SIZE = 100;
const CONCURRENCY = 10;

/**
 * Batched push notification fan-out with bounded concurrency.
 * Processes subscriptions in pages of BATCH_SIZE, with at most
 * CONCURRENCY in-flight push sends per batch.
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

  let offset = 0;
  let sent = 0;
  let removed = 0;

  while (true) {
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .orderBy(pushSubscriptions.id)
      .limit(BATCH_SIZE)
      .offset(offset);

    if (rows.length === 0) break;

    const pending = [...rows];
    const inFlight: Promise<void>[] = [];

    for (const row of pending) {
      const p = (async () => {
        const sub = {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };
        try {
          await webpush.sendNotification(sub, LIVE_PAYLOAD, {
            TTL: 3600,
            urgency: "high",
          });
          sent++;
        } catch (e: unknown) {
          const status =
            e && typeof e === "object" && "statusCode" in e
              ? (e as { statusCode?: number }).statusCode
              : undefined;
          if (isGoneStatus(status)) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.endpoint, row.endpoint));
            removed++;
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
      })();

      inFlight.push(p);

      if (inFlight.length >= CONCURRENCY) {
        await Promise.all(inFlight);
        inFlight.length = 0;
      }
    }

    if (inFlight.length > 0) await Promise.all(inFlight);

    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  if (sent > 0 || removed > 0) {
    log?.warn({ sent, removed }, "web_push_live_completed");
  }
}
