import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, userSecurityFingerprints } from "../db/schema.js";

function deviceHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function normalizeDeviceId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (v.length < 12 || v.length > 256) return null;
  return v;
}

export async function trackSecurityFingerprint(input: {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
}): Promise<{ suspicious: boolean; sharedUsers: number }> {
  const ip = (input.ip ?? "").trim() || "unknown";
  const ua = (input.userAgent ?? "").trim() || "unknown_ua";
  const rawDevice = normalizeDeviceId(input.deviceId);
  if (!rawDevice) {
    return { suspicious: false, sharedUsers: 0 };
  }
  const hash = deviceHash(rawDevice);

  await db
    .insert(userSecurityFingerprints)
    .values({
      userId: input.userId,
      ip,
      deviceHash: hash,
      userAgent: ua,
      seenCount: 1,
    })
    .onConflictDoUpdate({
      target: [
        userSecurityFingerprints.userId,
        userSecurityFingerprints.ip,
        userSecurityFingerprints.deviceHash,
      ],
      set: {
        userAgent: ua,
        seenCount: sql`${userSecurityFingerprints.seenCount} + 1`,
        lastSeenAt: sql`now()`,
      },
    });

  const [row] = await db
    .select({ c: sql<number>`count(distinct ${userSecurityFingerprints.userId})::int` })
    .from(userSecurityFingerprints)
    .where(eq(userSecurityFingerprints.deviceHash, hash));
  const sharedUsers = row?.c ?? 0;
  const suspicious = sharedUsers >= 3;
  if (suspicious) {
    await db
      .update(users)
      .set({
        multiAccountSuspected: true,
        multiAccountSuspectedAt: sql`now()`,
        multiAccountSharedUsers: sharedUsers,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, input.userId));
  }
  return { suspicious, sharedUsers };
}
