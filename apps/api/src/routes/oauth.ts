import type { FastifyInstance } from "fastify";
import { and, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { platformAccounts } from "../db/schema.js";
import { getRedis } from "../lib/redis.js";
import { encryptSecret } from "../lib/crypto.js";
import { assertOAuthCallbackRate } from "../lib/abuse.js";
import { authUser } from "../plugins/auth.js";
import {
  buildTwitchAuthorizeUrl,
  exchangeTwitchCode,
} from "../platforms/twitch/oauth.js";
import { helixGetOwnUser } from "../platforms/twitch/helix.js";
import {
  buildKickAuthorizeUrl,
  exchangeKickCode,
} from "../platforms/kick/oauth.js";
import { generatePkcePair } from "../platforms/kick/pkce.js";
import { kickValidateToken } from "../platforms/kick/api.js";
import { markReferralPercentEligible } from "../services/referralEligibility.js";
import { qualifyReferralOnPlatformLink } from "../services/referrals.js";

function webBase(): string {
  const raw = process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
  return raw.replace(/\/+$/, "");
}

function twitchRedirectUri(): string | undefined {
  return process.env.TWITCH_REDIRECT_URI?.trim();
}

function kickRedirectUri(): string | undefined {
  return process.env.KICK_REDIRECT_URI?.trim();
}

/** Редирект на наш домен: страница `/oauth/:platform` (не только query у /profile). */
function redirectSuccess(platform: "twitch" | "kick"): string {
  return `${webBase()}/oauth/${platform}?connected=1`;
}

function redirectError(platform: "twitch" | "kick", msg: string): string {
  return `${webBase()}/oauth/${platform}?error=${encodeURIComponent(msg)}`;
}

export async function registerOAuthRoutes(app: FastifyInstance) {
  app.get("/api/v1/oauth/twitch/url", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const redirectUri = twitchRedirectUri();
    if (!redirectUri) {
      return reply.status(500).send({
        error: {
          code: "oauth_misconfigured",
          message: "TWITCH_REDIRECT_URI required",
        },
      });
    }
    const state = nanoid(32);
    await getRedis().set(`oauth:tw:${state}`, userId, "EX", 600);
    const url = buildTwitchAuthorizeUrl({ state, redirectUri });
    return { url, state };
  });

  app.get("/api/v1/oauth/twitch/callback", async (req, reply) => {
    if (!(await assertOAuthCallbackRate(req.ip))) {
      return reply.redirect(redirectError("twitch", "rate_limited"));
    }
    const q = req.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
    if (q.error) {
      return reply.redirect(
        redirectError(
          "twitch",
          q.error_description ?? q.error ?? "oauth_denied"
        )
      );
    }
    if (!q.code || !q.state) {
      return reply.redirect(redirectError("twitch", "missing_code"));
    }

    const userId = await getRedis().get(`oauth:tw:${q.state}`);
    await getRedis().del(`oauth:tw:${q.state}`);
    if (!userId) {
      return reply.redirect(redirectError("twitch", "bad_state"));
    }

    const redirectUri = twitchRedirectUri();
    if (!redirectUri) {
      return reply.redirect(redirectError("twitch", "server"));
    }

    try {
      const tokens = await exchangeTwitchCode(q.code, redirectUri);
      const me = await helixGetOwnUser(tokens.access_token);
      if (!me) {
        return reply.redirect(redirectError("twitch", "helix_user"));
      }

      const [twitchTaken] = await db
        .select({ id: platformAccounts.id })
        .from(platformAccounts)
        .where(
          and(
            eq(platformAccounts.platform, "twitch"),
            eq(platformAccounts.externalUserId, me.id),
            ne(platformAccounts.userId, userId)
          )
        )
        .limit(1);
      if (twitchTaken) {
        return reply.redirect(
          redirectError(
            "twitch",
            "Этот Twitch уже привязан к другому аккаунту Telegram"
          )
        );
      }

      const accessEnc = encryptSecret(tokens.access_token);
      const refreshEnc = tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const avatarUrl = me.profile_image_url ?? null;

      await db
        .insert(platformAccounts)
        .values({
          userId,
          platform: "twitch",
          externalUserId: me.id,
          displayName: me.display_name,
          avatarUrl,
          accessTokenEnc: accessEnc,
          refreshTokenEnc: refreshEnc,
          scopes: tokens.scope,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [platformAccounts.userId, platformAccounts.platform],
          set: {
            externalUserId: me.id,
            displayName: me.display_name,
            avatarUrl,
            accessTokenEnc: accessEnc,
            refreshTokenEnc: refreshEnc,
            scopes: tokens.scope,
            expiresAt,
            updatedAt: sql`now()`,
          },
        });

      await markReferralPercentEligible(userId);
      await qualifyReferralOnPlatformLink(userId);
      return reply.redirect(redirectSuccess("twitch"));
    } catch (e) {
      app.log.error(e);
      return reply.redirect(redirectError("twitch", "token_exchange"));
    }
  });

  app.get("/api/v1/oauth/kick/url", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const redirectUri = kickRedirectUri();
    if (!redirectUri) {
      return reply.status(500).send({
        error: {
          code: "oauth_misconfigured",
          message: "KICK_REDIRECT_URI required",
        },
      });
    }
    const state = nanoid(32);
    const { verifier, challenge } = generatePkcePair();
    await getRedis().set(
      `oauth:kick:${state}`,
      JSON.stringify({ userId, codeVerifier: verifier }),
      "EX",
      600
    );
    const url = buildKickAuthorizeUrl({
      state,
      redirectUri,
      codeChallenge: challenge,
    });
    return { url, state };
  });

  app.get("/api/v1/oauth/kick/callback", async (req, reply) => {
    if (!(await assertOAuthCallbackRate(req.ip))) {
      return reply.redirect(redirectError("kick", "rate_limited"));
    }
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error) {
      return reply.redirect(redirectError("kick", q.error));
    }
    if (!q.code || !q.state) {
      return reply.redirect(redirectError("kick", "missing_code"));
    }

    const raw = await getRedis().get(`oauth:kick:${q.state}`);
    await getRedis().del(`oauth:kick:${q.state}`);
    if (!raw) {
      return reply.redirect(redirectError("kick", "bad_state"));
    }
    let parsed: { userId: string; codeVerifier: string };
    try {
      parsed = JSON.parse(raw) as { userId: string; codeVerifier: string };
    } catch {
      return reply.redirect(redirectError("kick", "bad_state"));
    }

    const redirectUri = kickRedirectUri();
    if (!redirectUri) {
      return reply.redirect(redirectError("kick", "server"));
    }

    try {
      const tokens = await exchangeKickCode(
        q.code,
        redirectUri,
        parsed.codeVerifier
      );
      const me =
        (await kickValidateToken(tokens.access_token)) ??
        ({
          id: "unknown",
          username: "kick",
          avatarUrl: null as string | null,
        } as {
          id: string;
          username?: string;
          avatarUrl?: string | null;
        });

      const accessEnc = encryptSecret(tokens.access_token);
      const refreshEnc = tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const displayName = me.username ?? "Kick";
      const avatarUrl = me.avatarUrl ?? null;

      if (me.id && me.id !== "unknown") {
        const [kickTaken] = await db
          .select({ id: platformAccounts.id })
          .from(platformAccounts)
          .where(
            and(
              eq(platformAccounts.platform, "kick"),
              eq(platformAccounts.externalUserId, me.id),
              ne(platformAccounts.userId, parsed.userId)
            )
          )
          .limit(1);
        if (kickTaken) {
          return reply.redirect(
            redirectError(
              "kick",
              "Этот Kick уже привязан к другому аккаунту Telegram"
            )
          );
        }
      }

      await db
        .insert(platformAccounts)
        .values({
          userId: parsed.userId,
          platform: "kick",
          externalUserId: me.id,
          displayName,
          avatarUrl,
          accessTokenEnc: accessEnc,
          refreshTokenEnc: refreshEnc,
          scopes: tokens.scope,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [platformAccounts.userId, platformAccounts.platform],
          set: {
            externalUserId: me.id,
            displayName,
            avatarUrl,
            accessTokenEnc: accessEnc,
            refreshTokenEnc: refreshEnc,
            scopes: tokens.scope,
            expiresAt,
            updatedAt: sql`now()`,
          },
        });

      await markReferralPercentEligible(parsed.userId);
      await qualifyReferralOnPlatformLink(parsed.userId);
      return reply.redirect(redirectSuccess("kick"));
    } catch (e) {
      app.log.error(e);
      return reply.redirect(redirectError("kick", "token_exchange"));
    }
  });
}
