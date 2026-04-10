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

type OauthRc = "tma" | "web";

function webBase(): string {
  const raw = process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
  return raw.replace(/\/+$/, "");
}

function parseReturnContextQuery(v: unknown): OauthRc {
  return v === "tma" ? "tma" : "web";
}

/** Значение в Redis для Twitch: JSON или legacy — только userId (старые state). */
function parseTwitchOAuthRedis(
  raw: string | null
): { userId: string; rc: OauthRc } | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as { userId?: unknown; rc?: unknown };
    if (o && typeof o.userId === "string" && o.userId.length > 0) {
      return {
        userId: o.userId,
        rc: o.rc === "tma" ? "tma" : "web",
      };
    }
  } catch {
    return { userId: raw, rc: "web" };
  }
  return null;
}

function twitchRedirectUri(): string | undefined {
  return process.env.TWITCH_REDIRECT_URI?.trim();
}

function kickRedirectUri(): string | undefined {
  return process.env.KICK_REDIRECT_URI?.trim();
}

/** Редирект на наш домен: страница `/oauth/:platform` (не только query у /profile). */
function redirectSuccess(platform: "twitch" | "kick", rc: OauthRc = "web"): string {
  const u = new URL(`${webBase()}/oauth/${platform}`);
  u.searchParams.set("connected", "1");
  u.searchParams.set("rc", rc);
  return u.toString();
}

function redirectError(
  platform: "twitch" | "kick",
  msg: string,
  rc: OauthRc = "web"
): string {
  const u = new URL(`${webBase()}/oauth/${platform}`);
  u.searchParams.set("error", msg);
  u.searchParams.set("rc", rc);
  return u.toString();
}

function parseKickRcOnly(raw: string | null): OauthRc {
  if (!raw) return "web";
  try {
    const o = JSON.parse(raw) as { rc?: unknown };
    return o.rc === "tma" ? "tma" : "web";
  } catch {
    return "web";
  }
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
    const q = req.query as { return_context?: string };
    const rc = parseReturnContextQuery(q.return_context);
    const state = nanoid(32);
    await getRedis().set(
      `oauth:tw:${state}`,
      JSON.stringify({ userId, rc }),
      "EX",
      600
    );
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

    if (!q.state) {
      return reply.redirect(redirectError("twitch", "bad_state"));
    }

    const rawTw = await getRedis().get(`oauth:tw:${q.state}`);
    await getRedis().del(`oauth:tw:${q.state}`);
    const twParsed = parseTwitchOAuthRedis(rawTw);
    const rcFromState: OauthRc = twParsed?.rc ?? "web";

    if (q.error) {
      return reply.redirect(
        redirectError(
          "twitch",
          q.error_description ?? q.error ?? "oauth_denied",
          rcFromState
        )
      );
    }
    if (!q.code) {
      return reply.redirect(
        redirectError("twitch", "missing_code", rcFromState)
      );
    }
    if (!twParsed) {
      return reply.redirect(redirectError("twitch", "bad_state", rcFromState));
    }
    const { userId, rc: oauthRc } = twParsed;

    const redirectUri = twitchRedirectUri();
    if (!redirectUri) {
      return reply.redirect(redirectError("twitch", "server", oauthRc));
    }

    try {
      const tokens = await exchangeTwitchCode(q.code, redirectUri);
      const me = await helixGetOwnUser(tokens.access_token);
      if (!me) {
        return reply.redirect(redirectError("twitch", "helix_user", oauthRc));
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
            "Этот Twitch уже привязан к другому аккаунту Telegram",
            oauthRc
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
      return reply.redirect(redirectSuccess("twitch", oauthRc));
    } catch (e) {
      app.log.error(e);
      return reply.redirect(
        redirectError("twitch", "token_exchange", oauthRc)
      );
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
    const kq = req.query as { return_context?: string };
    const rc = parseReturnContextQuery(kq.return_context);
    const state = nanoid(32);
    const { verifier, challenge } = generatePkcePair();
    await getRedis().set(
      `oauth:kick:${state}`,
      JSON.stringify({ userId, codeVerifier: verifier, rc }),
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

    if (!q.state) {
      return reply.redirect(redirectError("kick", "bad_state"));
    }

    const raw = await getRedis().get(`oauth:kick:${q.state}`);
    await getRedis().del(`oauth:kick:${q.state}`);
    const rcFromState = parseKickRcOnly(raw);

    if (q.error) {
      return reply.redirect(redirectError("kick", q.error, rcFromState));
    }
    if (!q.code) {
      return reply.redirect(
        redirectError("kick", "missing_code", rcFromState)
      );
    }
    if (!raw) {
      return reply.redirect(redirectError("kick", "bad_state", rcFromState));
    }

    let parsed: { userId: string; codeVerifier: string; rc?: string };
    try {
      parsed = JSON.parse(raw) as {
        userId: string;
        codeVerifier: string;
        rc?: string;
      };
    } catch {
      return reply.redirect(redirectError("kick", "bad_state", rcFromState));
    }

    const oauthRc: OauthRc = parsed.rc === "tma" ? "tma" : "web";

    const redirectUri = kickRedirectUri();
    if (!redirectUri) {
      return reply.redirect(redirectError("kick", "server", oauthRc));
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
              "Этот Kick уже привязан к другому аккаунту Telegram",
              oauthRc
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
      return reply.redirect(redirectSuccess("kick", oauthRc));
    } catch (e) {
      app.log.error(e);
      return reply.redirect(
        redirectError("kick", "token_exchange", oauthRc)
      );
    }
  });
}
