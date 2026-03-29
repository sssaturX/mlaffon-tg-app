import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
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

function webBase(): string {
  return process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
}

function redirectSuccess(platform: string): string {
  return `${webBase()}/profile?oauth_ok=${platform}`;
}

function redirectError(msg: string): string {
  return `${webBase()}/profile?oauth_err=${encodeURIComponent(msg)}`;
}

export async function registerOAuthRoutes(app: FastifyInstance) {
  app.get("/api/v1/oauth/twitch/url", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const redirectUri = process.env.TWITCH_REDIRECT_URI;
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
      return reply.redirect(redirectError("rate_limited"));
    }
    const q = req.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
    if (q.error) {
      return reply.redirect(
        redirectError(q.error_description ?? q.error ?? "oauth_denied")
      );
    }
    if (!q.code || !q.state) {
      return reply.redirect(redirectError("missing_code"));
    }

    const userId = await getRedis().get(`oauth:tw:${q.state}`);
    await getRedis().del(`oauth:tw:${q.state}`);
    if (!userId) {
      return reply.redirect(redirectError("bad_state"));
    }

    const redirectUri = process.env.TWITCH_REDIRECT_URI;
    if (!redirectUri) {
      return reply.redirect(redirectError("server"));
    }

    try {
      const tokens = await exchangeTwitchCode(q.code, redirectUri);
      const me = await helixGetOwnUser(tokens.access_token);
      if (!me) {
        return reply.redirect(redirectError("helix_user"));
      }

      const accessEnc = encryptSecret(tokens.access_token);
      const refreshEnc = tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await db
        .insert(platformAccounts)
        .values({
          userId,
          platform: "twitch",
          externalUserId: me.id,
          displayName: me.display_name,
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
            accessTokenEnc: accessEnc,
            refreshTokenEnc: refreshEnc,
            scopes: tokens.scope,
            expiresAt,
            updatedAt: sql`now()`,
          },
        });

      return reply.redirect(redirectSuccess("twitch"));
    } catch (e) {
      app.log.error(e);
      return reply.redirect(redirectError("token_exchange"));
    }
  });

  app.get("/api/v1/oauth/kick/url", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const redirectUri = process.env.KICK_REDIRECT_URI;
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
      return reply.redirect(redirectError("rate_limited"));
    }
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error) {
      return reply.redirect(redirectError(q.error));
    }
    if (!q.code || !q.state) {
      return reply.redirect(redirectError("missing_code"));
    }

    const raw = await getRedis().get(`oauth:kick:${q.state}`);
    await getRedis().del(`oauth:kick:${q.state}`);
    if (!raw) {
      return reply.redirect(redirectError("bad_state"));
    }
    let parsed: { userId: string; codeVerifier: string };
    try {
      parsed = JSON.parse(raw) as { userId: string; codeVerifier: string };
    } catch {
      return reply.redirect(redirectError("bad_state"));
    }

    const redirectUri = process.env.KICK_REDIRECT_URI;
    if (!redirectUri) {
      return reply.redirect(redirectError("server"));
    }

    try {
      const tokens = await exchangeKickCode(
        q.code,
        redirectUri,
        parsed.codeVerifier
      );
      const me =
        (await kickValidateToken(tokens.access_token)) ??
        ({ id: "unknown", username: "kick" } as const);

      const accessEnc = encryptSecret(tokens.access_token);
      const refreshEnc = tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await db
        .insert(platformAccounts)
        .values({
          userId: parsed.userId,
          platform: "kick",
          externalUserId: me.id,
          displayName: me.username ?? "Kick",
          accessTokenEnc: accessEnc,
          refreshTokenEnc: refreshEnc,
          scopes: tokens.scope,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [platformAccounts.userId, platformAccounts.platform],
          set: {
            externalUserId: me.id,
            displayName: me.username ?? "Kick",
            accessTokenEnc: accessEnc,
            refreshTokenEnc: refreshEnc,
            scopes: tokens.scope,
            expiresAt,
            updatedAt: sql`now()`,
          },
        });

      return reply.redirect(redirectSuccess("kick"));
    } catch (e) {
      app.log.error(e);
      return reply.redirect(redirectError("token_exchange"));
    }
  });
}
