import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformAccounts } from "../db/schema.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { refreshTwitchToken } from "../platforms/twitch/oauth.js";
import { refreshKickToken } from "../platforms/kick/oauth.js";

export interface DecryptedPlatformAccount {
  id: string;
  platform: string;
  externalUserId: string | null;
  displayName: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

function parseScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  return [];
}

export async function getTwitchAccount(
  userId: string
): Promise<DecryptedPlatformAccount | null> {
  const [row] = await db
    .select()
    .from(platformAccounts)
    .where(
      and(
        eq(platformAccounts.userId, userId),
        eq(platformAccounts.platform, "twitch")
      )
    )
    .limit(1);
  if (!row?.accessTokenEnc || row.accessTokenEnc === "stub") return null;
  try {
    let accessToken = decryptSecret(row.accessTokenEnc);
    let expiresAt = row.expiresAt;
    let refreshEnc = row.refreshTokenEnc;

    if (
      expiresAt &&
      expiresAt.getTime() < Date.now() + 60_000 &&
      refreshEnc
    ) {
      const refreshed = await refreshTwitchToken(decryptSecret(refreshEnc));
      accessToken = refreshed.access_token;
      expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
      const newAccessEnc = encryptSecret(accessToken);
      const newRefreshEnc = refreshed.refresh_token
        ? encryptSecret(refreshed.refresh_token)
        : refreshEnc;
      await db
        .update(platformAccounts)
        .set({
          accessTokenEnc: newAccessEnc,
          refreshTokenEnc: newRefreshEnc,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(platformAccounts.id, row.id));
    }

    return {
      id: row.id,
      platform: "twitch",
      externalUserId: row.externalUserId,
      displayName: row.displayName,
      accessToken,
      refreshToken: refreshEnc ? decryptSecret(refreshEnc) : null,
      expiresAt,
      scopes: parseScopes(row.scopes),
    };
  } catch {
    return null;
  }
}

export async function getKickAccount(
  userId: string
): Promise<DecryptedPlatformAccount | null> {
  const [row] = await db
    .select()
    .from(platformAccounts)
    .where(
      and(
        eq(platformAccounts.userId, userId),
        eq(platformAccounts.platform, "kick")
      )
    )
    .limit(1);
  if (!row?.accessTokenEnc || row.accessTokenEnc === "stub") return null;
  try {
    let accessToken = decryptSecret(row.accessTokenEnc);
    let expiresAt = row.expiresAt;
    let refreshEnc = row.refreshTokenEnc;

    if (
      expiresAt &&
      expiresAt.getTime() < Date.now() + 60_000 &&
      refreshEnc
    ) {
      const refreshed = await refreshKickToken(decryptSecret(refreshEnc));
      accessToken = refreshed.access_token;
      expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
      await db
        .update(platformAccounts)
        .set({
          accessTokenEnc: encryptSecret(accessToken),
          refreshTokenEnc: refreshed.refresh_token
            ? encryptSecret(refreshed.refresh_token)
            : refreshEnc,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(platformAccounts.id, row.id));
    }

    return {
      id: row.id,
      platform: "kick",
      externalUserId: row.externalUserId,
      displayName: row.displayName,
      accessToken,
      refreshToken: refreshEnc ? decryptSecret(refreshEnc) : null,
      expiresAt,
      scopes: parseScopes(row.scopes),
    };
  } catch {
    return null;
  }
}
