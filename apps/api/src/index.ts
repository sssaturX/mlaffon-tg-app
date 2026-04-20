import "dotenv/config";
import { validateEnv } from "./lib/envValidation.js";
validateEnv();

import { initSentry, captureException } from "./lib/sentry.js";
initSentry();

import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db, pool, waitForDatabaseReady } from "./db/index.js";
import { platformAccounts } from "./db/schema.js";
import {
  assertFreshAuth,
  parseInitData,
  verifyTelegramInitData,
} from "./lib/telegram.js";
import { signSession, verifySession } from "./lib/jwt.js";
import {
  LinkTokenError,
  createTelegramLinkToken,
} from "./services/accountLink.js";
import {
  attachEmailPasswordToUser,
  loginWithEmail,
  registerWithEmail,
} from "./services/webAuth.js";
import {
  applyReferralFromStartParam,
  ensureUserFromTelegram,
  deleteUserAccount,
} from "./services/users.js";
import {
  buildMeEconomyResponse,
  buildMeProfileResponse,
  buildMeResponse,
} from "./services/me.js";
import { createBanAppeal } from "./services/banAppeals.js";
import {
  claimTask,
  filterTasksForPlatform,
  listTasksForUser,
} from "./services/tasks.js";
import { registerStreamTaskMessage } from "./services/taskStreamMessages.js";
import { getLeaderboard, rankOfUser } from "./services/leaderboard.js";
import { referrals, users } from "./db/schema.js";
import { authUser, registerAuth } from "./plugins/auth.js";
import { gameConfig } from "./config.js";
import {
  getFortuneConfigResponse,
  getFortuneStateResponse,
  getFortuneStatus,
  spinFortuneWheel,
} from "./services/fortune.js";
import { getShopClientBundle, purchaseItem } from "./services/shop.js";
import { registerOAuthRoutes } from "./routes/oauth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerGiveawayRoutes } from "./routes/giveaways.js";
import { registerPredictionRoutes } from "./routes/predictions.js";
import { registerDropRoutes } from "./routes/drops.js";
import { registerPushRoutes } from "./routes/push.js";
import { registerTelegramWebhookRoutes } from "./routes/telegramWebhook.js";
import { registerMediaRoutes } from "./routes/media.js";
import { MAX_ORIGINAL_IMAGE_BYTES } from "./services/mediaConfig.js";
import { maybeStartTelegramLongPolling } from "./services/telegramPolling.js";
import {
  buildHomeContentResponse,
  buildHomeGiveawaysResponse,
  buildHomePublicResponse,
} from "./services/homePublic.js";
import { applyPromoForUser } from "./services/promo.js";
import { assertClaimRateLimits } from "./lib/abuse.js";
import {
  getActiveLiveBroadcast,
  watchLiveBroadcast,
} from "./services/liveBroadcast.js";
import { markReferralPercentEligible } from "./services/referralEligibility.js";
import { handleRealtimeWsConnection } from "./services/realtimeWs.js";
import { startRealtimeSubscriber } from "./services/realtimePublish.js";
import { seedDefaultPointPlatforms } from "./services/platformBalances.js";
import { trackSecurityFingerprint } from "./services/securitySignals.js";
import { enqueueFraudReviewJob } from "./services/fraudReviewQueue.js";
import { taskEvidence, tasks } from "./db/schema.js";
import { invalidateUserTaskDtoCache } from "./services/taskUserListCache.js";
import { resolveCorsOrigin } from "./lib/corsOrigins.js";
import { sanitizeRequestUrlForLog } from "./lib/sanitizeLogUrl.js";
import { issueWsTicket } from "./lib/wsTicket.js";
import { warmupRedis } from "./lib/redis.js";
import { startPgPoolMetrics } from "./lib/pgPoolMetrics.js";
import { startEventLoopMonitor } from "./lib/eventLoopMonitor.js";
import {
  buildRequestTracePayload,
  initRequestTrace,
  shouldEmitRequestTrace,
} from "./lib/requestTrace.js";

const AUTH_RATE_LIMIT_MAX = Number.parseInt(
  process.env.AUTH_RATE_LIMIT_MAX ?? "15",
  10
);
const AUTH_RATE_LIMIT_WINDOW_MS = Number.parseInt(
  process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? String(15 * 60 * 1000),
  10
);

const authRouteRateHeaders = {
  "x-ratelimit-limit": true,
  "x-ratelimit-remaining": true,
  "x-ratelimit-reset": true,
  "retry-after": true,
} as const;

/** Base64-скрины в JSON; дефолт Fastify 1 МБ режет загрузку evidence. */
const JSON_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

const app = Fastify({
  bodyLimit: JSON_BODY_LIMIT_BYTES,
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    serializers: {
      req(request: {
        id?: string;
        method?: string;
        url?: string;
        headers?: Record<string, string | string[] | undefined>;
        ip?: string;
        socket?: { remoteAddress?: string; remotePort?: number };
      }) {
        const headers = { ...(request.headers ?? {}) };
        if (headers.authorization) headers.authorization = "<redacted>";
        if (headers.cookie) headers.cookie = "<redacted>";
        return {
          id: request.id,
          method: request.method,
          url: sanitizeRequestUrlForLog(String(request.url ?? "")),
          headers,
          remoteAddress: request.ip ?? request.socket?.remoteAddress,
          remotePort: request.socket?.remotePort,
        };
      },
    },
  },
});

app.addHook("onRequest", (req, _reply, done) => {
  initRequestTrace(req);
  done();
});

const SLOW_REQ_MS = Number.parseInt(process.env.API_SLOW_REQUEST_MS ?? "2000", 10);
const TRACE_SAMPLE_RATE = Number.parseFloat(
  process.env.API_TRACE_SAMPLE_RATE ?? "0"
);
if (SLOW_REQ_MS > 0 || (Number.isFinite(TRACE_SAMPLE_RATE) && TRACE_SAMPLE_RATE > 0)) {
  app.addHook("onResponse", (req, reply, done) => {
    const ms = reply.elapsedTime;
    const path = String(req.url ?? "").split("?")[0] ?? "";
    if (!path.startsWith("/api")) {
      done();
      return;
    }
    const elapsed = typeof ms === "number" ? ms : 0;
    const sampleRoll = Math.random();
    const tracePayload = buildRequestTracePayload(req, elapsed);
    const slow =
      SLOW_REQ_MS > 0 && typeof ms === "number" && ms >= SLOW_REQ_MS;
    const sampled = shouldEmitRequestTrace(elapsed, sampleRoll);

    const contentLength = reply.getHeader("content-length");
    const extra =
      tracePayload != null
        ? { ...tracePayload, ...(contentLength ? { contentLength } : {}) }
        : contentLength
          ? { contentLength }
          : {};

    if (slow) {
      req.log.warn(
        {
          ms: elapsed,
          method: req.method,
          url: sanitizeRequestUrlForLog(String(req.url ?? "")),
          ...extra,
        },
        "slow_api_request"
      );
    } else if (sampled && Object.keys(extra).length > 0) {
      req.log.info(
        {
          ms: elapsed,
          method: req.method,
          url: sanitizeRequestUrlForLog(String(req.url ?? "")),
          ...extra,
        },
        "request_trace"
      );
    }
    done();
  });
}

await app.register(cors, {
  origin: resolveCorsOrigin(),
  credentials: true,
});

await app.register(rateLimit, {
  max: gameConfig.rateLimit.maxPerWindow,
  timeWindow: gameConfig.rateLimit.timeWindowMs,
  allowList: (req) => {
    const p = req.url.split("?")[0] ?? "";
    if (
      p === "/api/v1/ws" ||
      p === "/health" ||
      p === "/api/v1/telegram/webhook"
    ) {
      return true;
    }
    return false;
  },
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const p = verifySession(auth.slice(7));
        if (p.sub) return `user:${p.sub}`;
      } catch {
        /* invalid/expired token — fall through to IP-based limiting */
      }
    }
    return req.ip;
  },
});

await app.register(websocket);

await app.register(multipart, {
  limits: { fileSize: MAX_ORIGINAL_IMAGE_BYTES },
});

await registerAuth(app);

app.post("/api/v1/ws-ticket", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  try {
    const ticket = await issueWsTicket(userId);
    return { ticket };
  } catch (e) {
    req.log.error({ err: e }, "ws_ticket_issue_failed");
    return reply.status(503).send({
      error: {
        code: "service_unavailable",
        message: "Не удалось выдать билет. Попробуйте позже.",
      },
    });
  }
});

app.get("/api/v1/ws", { websocket: true }, (socket, req) => {
  /** `req.url` иногда без query за прокси; у Node `raw.url` — путь + query. */
  const pathAndQuery = req.raw.url ?? req.url;
  void handleRealtimeWsConnection(socket, pathAndQuery, req.ip, req.log);
});
await registerOAuthRoutes(app);
await registerAdminRoutes(app);
await registerGiveawayRoutes(app);
await registerPredictionRoutes(app);
await registerDropRoutes(app);
await registerPushRoutes(app);
await registerTelegramWebhookRoutes(app);
await registerMediaRoutes(app);

import { registerMetricsHooks, registerMetricsEndpoint } from "./lib/metrics.js";
registerMetricsHooks(app);
registerMetricsEndpoint(app);

app.get("/health", async () => {
  const checks: Record<string, string> = {};
  try {
    await pool.query("SELECT 1");
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }
  try {
    const { getRedis } = await import("./lib/redis.js");
    await getRedis().ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }
  const ok = checks.db === "ok" && checks.redis === "ok";
  return { ok, checks };
});

app.get("/health/ready", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    const { getRedis } = await import("./lib/redis.js");
    await getRedis().ping();
    return { ready: true };
  } catch {
    return reply.status(503).send({ ready: false });
  }
});

app.get("/version", async () => {
  return {
    commit: process.env.GIT_COMMIT ?? "unknown",
    release: process.env.SENTRY_RELEASE ?? "unknown",
    buildTime: process.env.BUILD_TIME ?? "unknown",
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
});

app.get("/api/v1/home/public", async (_req, reply) => {
  void reply.header(
    "Cache-Control",
    "public, max-age=300, stale-while-revalidate=3600"
  );
  return buildHomePublicResponse();
});

app.get("/api/v1/home/content", async (_req, reply) => {
  void reply.header(
    "Cache-Control",
    "public, max-age=300, stale-while-revalidate=3600"
  );
  return buildHomeContentResponse();
});

app.get("/api/v1/home/giveaways", async (_req, reply) => {
  void reply.header(
    "Cache-Control",
    "public, max-age=30, stale-while-revalidate=120"
  );
  return buildHomeGiveawaysResponse();
});

const promoBody = z.object({
  code: z.string().min(1),
});

app.post(
  "/api/v1/promo/apply",
  {
    config: {
      rateLimit: {
        max: gameConfig.routeRateLimits.promoApply.max,
        timeWindow: gameConfig.routeRateLimits.promoApply.timeWindowMs,
      },
    },
  },
  async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = promoBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: "Введите промокод." },
    });
  }
  const r = await applyPromoForUser(userId, parsed.data.code);
  if (!r.ok) {
    const status: Record<string, number> = {
      not_found: 404,
      exhausted: 410,
      already_used: 409,
      empty_code: 400,
      duplicate: 409,
      credit_failed: 503,
    };
    const promoMsg: Record<string, string> = {
      not_found: "Промокод не найден",
      exhausted: "Этот промокод больше не действует",
      already_used: "Вы уже использовали этот промокод",
      empty_code: "Введите промокод",
      duplicate: "Промокод уже применён",
      credit_failed: "Не удалось начислить награду. Попробуйте позже.",
    };
    return reply.status(status[r.error] ?? 400).send({
      error: {
        code: r.error,
        message: promoMsg[r.error] ?? "Не удалось применить промокод",
      },
    });
  }
  return { ok: true, reward: r.reward };
  }
);

const authBody = z.object({
  initData: z.string().min(1),
});

app.post("/api/v1/auth/telegram", async (req, reply) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return reply.status(500).send({
      error: {
        code: "server_misconfigured",
        message: "Сервис временно недоступен. Попробуйте позже.",
      },
    });
  }

  const parsed = authBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: {
        code: "bad_request",
        message: "Некорректный запрос. Откройте приложение из бота.",
      },
    });
  }

  const { initData } = parsed.data;
  if (!verifyTelegramInitData(initData, botToken)) {
    return reply.status(401).send({
      error: {
        code: "invalid_init_data",
        message:
          "Не удалось подтвердить вход из Telegram. Откройте приложение из бота.",
      },
    });
  }

  const { user, startParam, authDate } = parseInitData(initData);
  assertFreshAuth(authDate);

  if (!user?.id) {
    return reply.status(400).send({
      error: {
        code: "no_user",
        message: "Не удалось получить профиль Telegram. Откройте приложение из бота.",
      },
    });
  }

  try {
    const { userId, accountsMerged } = await ensureUserFromTelegram(
      user,
      startParam
    );
    await applyReferralFromStartParam(userId, BigInt(user.id), startParam);
    const token = signSession(userId, BigInt(user.id));
    return {
      token,
      userId,
      ...(accountsMerged ? { accountsMerged: true as const } : {}),
    };
  } catch (e) {
    if (e instanceof LinkTokenError) {
      const status =
        e.code === "telegram_already_linked" || e.code === "account_already_linked"
          ? 409
          : e.code === "merge_failed"
            ? 503
            : 400;
      return reply.status(status).send({
        error: { code: e.code, message: e.message },
      });
    }
    req.log.error(e);
    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "Не удалось войти. Попробуйте позже.",
      },
    });
  }
});

const webAuthBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  /** Код приглашения с сайта (тот же, что в профиле; 10 символов). */
  referralCode: z.string().max(32).optional(),
});

app.post(
  "/api/v1/auth/register",
  {
    config: {
      rateLimit: {
        max: AUTH_RATE_LIMIT_MAX,
        timeWindow: AUTH_RATE_LIMIT_WINDOW_MS,
        hook: "preHandler",
        keyGenerator: (req) => {
          const body = req.body as { email?: string } | undefined;
          const em =
            typeof body?.email === "string"
              ? body.email.toLowerCase().slice(0, 320)
              : "";
          return em
            ? `auth_register:${req.ip}:${em}`
            : `auth_register:${req.ip}`;
        },
        addHeaders: authRouteRateHeaders,
        errorResponseBuilder: (_req, ctx) => ({
          error: {
            code: "too_many_requests",
            message: "Слишком много попыток регистрации. Подождите и попробуйте снова.",
            retryAfterSec: Math.max(1, Math.ceil(ctx.ttl / 1000)),
          },
        }),
      },
    },
  },
  async (req, reply) => {
    const parsed = webAuthBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "bad_request",
          message:
            "Укажите корректный email и пароль не короче 8 символов.",
        },
      });
    }
    const refRaw = parsed.data.referralCode?.trim();
    const r = await registerWithEmail(parsed.data.email, parsed.data.password, {
      referralCode: refRaw && refRaw.length > 0 ? refRaw : undefined,
      clientIp: req.ip,
    });
    if (!r.ok) {
      if (r.code === "email_taken") {
        return reply.status(409).send({
          error: {
            code: r.code,
            message: "Этот email уже зарегистрирован",
          },
        });
      }
      return reply.status(400).send({
        error: {
          code: r.code,
          message: "Пароль не менее 8 символов",
        },
      });
    }
    return { token: r.token, userId: r.userId };
  }
);

app.post(
  "/api/v1/auth/login",
  {
    config: {
      rateLimit: {
        max: AUTH_RATE_LIMIT_MAX,
        timeWindow: AUTH_RATE_LIMIT_WINDOW_MS,
        hook: "preHandler",
        keyGenerator: (req) => {
          const body = req.body as { email?: string } | undefined;
          const em =
            typeof body?.email === "string"
              ? body.email.toLowerCase().slice(0, 320)
              : "";
          return em ? `auth_login:${req.ip}:${em}` : `auth_login:${req.ip}`;
        },
        addHeaders: authRouteRateHeaders,
        errorResponseBuilder: (_req, ctx) => ({
          error: {
            code: "too_many_requests",
            message: "Слишком много попыток входа. Подождите и попробуйте снова.",
            retryAfterSec: Math.max(1, Math.ceil(ctx.ttl / 1000)),
          },
        }),
      },
    },
  },
  async (req, reply) => {
    const parsed = webAuthBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "bad_request",
          message:
            "Укажите корректный email и пароль не короче 8 символов.",
        },
      });
    }
    const r = await loginWithEmail(parsed.data.email, parsed.data.password);
    if (!r.ok) {
      return reply.status(401).send({
        error: {
          code: r.code,
          message: "Неверный email или пароль",
        },
      });
    }
    return { token: r.token, userId: r.userId };
  }
);

app.post("/api/v1/auth/link/telegram", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const out = await createTelegramLinkToken(userId);
  return {
    linkToken: out.token,
    expiresAt: out.expiresAt,
    botStartUrl: out.botStartUrl,
  };
});

/** В production маршрут не регистрируется — иначе обход Telegram-подписи. */
const allowDevAuthRoute =
  process.env.NODE_ENV !== "production" &&
  process.env.ALLOW_DEV_AUTH === "1";

if (allowDevAuthRoute) {
  const devBody = z.object({
    telegramId: z.coerce.number().int().positive(),
    username: z.string().optional(),
  });
  app.post("/api/v1/auth/dev", async (req, reply) => {
    const parsed = devBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "Некорректные данные." },
      });
    }
    const { telegramId, username } = parsed.data;
    const { userId } = await ensureUserFromTelegram(
      {
        id: telegramId,
        username: username ?? "dev_user",
        first_name: "Dev",
      },
      null
    );
    const token = signSession(userId, BigInt(telegramId));
    return { token, userId };
  });
}

app.get("/api/v1/me", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  void reply.header(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate"
  );
  return buildMeResponse(userId);
});

app.get("/api/v1/me/profile", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  void reply.header(
    "Cache-Control",
    "private, max-age=60, stale-while-revalidate=300"
  );
  return buildMeProfileResponse(userId);
});

app.get("/api/v1/me/economy", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  void reply.header(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate"
  );
  return buildMeEconomyResponse(userId);
});

const meWebCredentialsBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

app.post("/api/v1/me/web-credentials", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = meWebCredentialsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: {
        code: "bad_request",
        message:
          "Укажите корректный email и пароль не короче 8 символов.",
      },
    });
  }
  const r = await attachEmailPasswordToUser(
    userId,
    parsed.data.email,
    parsed.data.password
  );
  if (!r.ok) {
    const messages: Record<string, string> = {
      email_taken: "Этот email уже используется в другом аккаунте",
      weak_password: "Пароль не менее 8 символов",
      already_has_credentials:
        "Вход по email уже настроен — используйте его на сайте",
    };
    const status =
      r.code === "email_taken" || r.code === "already_has_credentials"
        ? 409
        : 400;
    return reply.status(status).send({
      error: {
        code: r.code,
        message:
          messages[r.code] ?? "Не удалось сохранить email и пароль",
      },
    });
  }
  return { ok: true };
});

const banAppealBody = z.object({
  message: z.string().min(10).max(4000),
});

app.post("/api/v1/ban-appeal", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = banAppealBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: {
        code: "bad_request",
        message: "Напишите сообщение от 10 до 4000 символов.",
      },
    });
  }
  const r = await createBanAppeal(userId, parsed.data.message);
  if (!r.ok) {
    const status: Record<typeof r.code, number> = {
      not_banned: 400,
      already_pending: 409,
      too_short: 400,
    };
    const messages: Record<typeof r.code, string> = {
      not_banned: "Апелляция доступна только при активной блокировке",
      already_pending: "Апелляция уже отправлена и ожидает рассмотрения",
      too_short: "Текст слишком короткий",
    };
    return reply.status(status[r.code]).send({
      error: {
        code: r.code,
        message: messages[r.code] ?? "Не удалось отправить обращение",
      },
    });
  }
  return { ok: true };
});

app.get("/api/v1/live-broadcast", async (_req, reply) => {
  void reply.header(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate"
  );
  const b = await getActiveLiveBroadcast();
  if (!b) {
    return { active: false as const };
  }
  return {
    active: true as const,
    id: b.id,
    platform: b.platform as "twitch" | "kick",
    streamUrl: b.streamUrl,
    vpnNote: b.vpnNote,
    startedAt: b.startedAt.toISOString(),
  };
});

const liveWatchBody = z.object({
  broadcastId: z.string().uuid(),
});

app.post("/api/v1/live-broadcast/watch", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = liveWatchBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: "Некорректные данные эфира." },
    });
  }
  const lim = await assertClaimRateLimits(userId, req.ip);
  if (!lim.ok) {
    return reply.status(429).send({
      error: {
        code: "rate_limited",
        message: "Слишком много действий подряд. Подождите немного.",
      },
    });
  }
  const res = await watchLiveBroadcast(userId, parsed.data.broadcastId);
  if (!res.ok) {
    const msg =
      res.code === "not_active"
        ? "Эфир уже завершён"
        : "Трансляция не найдена";
    return reply.status(400).send({
      error: { code: res.code, message: msg },
    });
  }
  return {
    ok: true,
    platform: res.platform,
    streak: res.streak,
    streakIncremented: res.streakIncremented,
    alreadyWatchedThisBroadcast: res.alreadyWatchedThisBroadcast,
    bonusCoinsAwarded: res.bonusCoinsAwarded,
  };
});

app.get("/api/v1/tasks", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const platform = String(
    (req.query as { platform?: string }).platform ?? "all"
  );
  const list = filterTasksForPlatform(
    await listTasksForUser(userId),
    platform
  );
  /** Не кэшировать агрессивно: каталог и meta (обложки, тексты) меняются из админки. */
  void reply.header("Cache-Control", "private, no-cache, must-revalidate");
  return { tasks: list };
});

app.post("/api/v1/tasks/:id/claim", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const sec = await trackSecurityFingerprint({
    userId,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    deviceId: String(req.headers["x-device-id"] ?? ""),
  });
  if (sec.suspicious) {
    void enqueueFraudReviewJob({
      kind: "task_claim_blocked",
      userId,
      sharedUsers: sec.sharedUsers,
      ip: String(req.ip ?? ""),
      userAgent: String(req.headers["user-agent"] ?? ""),
      deviceId: String(req.headers["x-device-id"] ?? ""),
    });
    return reply.status(403).send({
      error: {
        code: "multi_account_suspected",
        message: "Подозрение на мультиаккаунт. Обратитесь в поддержку.",
      },
    });
  }
  const lim = await assertClaimRateLimits(userId, req.ip);
  if (!lim.ok) {
    return reply.status(429).send({
      error: {
        code: "rate_limited",
        message: "Слишком много действий подряд. Подождите немного.",
      },
    });
  }
  const id = (req.params as { id: string }).id;
  const res = await claimTask(userId, id);
  if (!res.ok) {
    const map: Record<string, number> = {
      task_not_found: 404,
      already_completed: 409,
      platform_required: 403,
      progress_not_reached: 400,
      evidence_required: 400,
      evidence_pending: 409,
      multi_account_suspected: 403,
      queue_unavailable: 503,
      not_following: 400,
      not_subscribed: 400,
      no_oauth: 403,
      helix_user: 502,
      no_broadcaster: 500,
      kick_user: 502,
      no_channel: 500,
      unknown_platform: 500,
      telegram_chat_not_configured: 500,
      telegram_not_linked: 403,
      telegram_not_subscribed: 400,
      grant_failed: 500,
      verify_failed: 400,
    };
    const claimMsg: Record<string, string> = {
      task_not_found: "Задание не найдено",
      already_completed: "Уже выполнено",
      platform_required: "Подключите Twitch или Kick в профиле",
      progress_not_reached: "Цель задания ещё не достигнута",
      evidence_required: "Сначала загрузите подтверждающие изображения",
      evidence_pending: "Доказательства ещё не проверены админом",
      multi_account_suspected: "Подозрение на мультиаккаунт. Обратитесь в поддержку.",
      queue_unavailable:
        "Проверка задания временно недоступна. Попробуйте позже.",
      not_following: "Подписка на канал не найдена. Подпишитесь и попробуйте снова.",
      not_subscribed: "Платная подписка на канал не найдена.",
      no_oauth: "Подключите Twitch или Kick в профиле.",
      helix_user:
        "Не удалось проверить Twitch. Обновите привязку в профиле и попробуйте снова.",
      no_broadcaster: "Задание настроено неверно (канал). Напишите в поддержку.",
      kick_user:
        "Не удалось проверить Kick. Обновите привязку в профиле и попробуйте снова.",
      no_channel: "Задание настроено неверно (Kick). Напишите в поддержку.",
      unknown_platform: "Тип задания не поддерживается.",
      telegram_chat_not_configured:
        "Задание настроено неверно (Telegram). Напишите в поддержку.",
      telegram_not_linked: "Привяжите Telegram в профиле.",
      telegram_not_subscribed: "Нужна подписка на канал из задания.",
      grant_failed: "Не удалось начислить награду. Попробуйте позже.",
      verify_failed: "Проверка не прошла. Попробуйте позже.",
    };
    return reply.status(map[res.error] ?? 400).send({
      error: {
        code: res.error,
        message: claimMsg[res.error] ?? "Не удалось выполнить действие",
      },
    });
  }
  if (res.mode === "async") {
    return reply.status(202).send({
      ok: true,
      status: "pending",
      jobId: res.jobId,
    });
  }
  const q = req.query as { platform?: string };
  const platform = String(q.platform ?? "all");
  const tasks = filterTasksForPlatform(
    await listTasksForUser(userId),
    platform
  );
  return {
    ok: true,
    reward: res.reward,
    tasks,
  };
});

app.get("/api/v1/leaderboard", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const q = req.query as { sort?: string; platform?: string };
  const sort =
    q.sort === "streak" || q.sort === "referrals" ? q.sort : "coins";
  const platform =
    q.platform === "twitch" || q.platform === "kick" ? q.platform : "all";

  const top = await getLeaderboard({ sort, platform, limit: 50 });
  const meRank = await rankOfUser(sort, platform, userId);

  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const entries = top.map((e, i) => ({
    rank: i + 1,
    userId: e.userId,
    displayName: e.displayName,
    value: e.value,
    photoUrl: e.photoUrl,
  }));

  const meEntry =
    meRank && u
      ? {
          rank: meRank.rank,
          userId,
          displayName:
            u.username ??
            u.firstName ??
            (u.telegramId != null ? `tg:${u.telegramId}` : (u.email ?? "—")),
          value: meRank.value,
          photoUrl: u.photoUrl,
        }
      : null;

  void reply.header(
    "Cache-Control",
    "private, max-age=30, stale-while-revalidate=120"
  );
  return { sort, platform, top: entries, me: meEntry };
});

app.get("/api/v1/referrals", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const me = await buildMeProfileResponse(userId);

  const rows = await db
    .select({
      refereeId: referrals.refereeId,
      createdAt: referrals.createdAt,
      qualifiedAt: referrals.qualifiedAt,
      username: users.username,
      firstName: users.firstName,
      telegramId: users.telegramId,
      email: users.email,
    })
    .from(referrals)
    .innerJoin(users, eq(referrals.refereeId, users.id))
    .where(eq(referrals.referrerId, userId));

  const invited = rows.map((r) => ({
    refereeId: r.refereeId,
    displayName:
      r.username ??
      r.firstName ??
      (r.telegramId != null
        ? String(r.telegramId)
        : (r.email ?? "?")),
    createdAt: r.createdAt?.toISOString() ?? "",
    qualified: !!r.qualifiedAt,
  }));

  const qualifiedCount = invited.filter((i) => i.qualified).length;

  void reply.header(
    "Cache-Control",
    "private, max-age=60, stale-while-revalidate=300"
  );
  return {
    referralLink: me.referralLink,
    referralLinkMiniApp: me.referralLinkMiniApp,
    referralLinkWeb: me.referralLinkWeb,
    totalInvited: invited.length,
    qualifiedCount,
    invited,
  };
});

if (allowDevAuthRoute) {
  app.post("/api/v1/platforms/:platform/connect", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const platform = (req.params as { platform: string }).platform;
    if (platform !== "twitch" && platform !== "kick") {
      return reply.status(400).send({
        error: { code: "bad_platform", message: "Выберите Twitch или Kick" },
      });
    }
    const body = (req.body as { displayName?: string }) ?? {};
    const displayName = body.displayName ?? `stub_${platform}`;

    await db
      .insert(platformAccounts)
      .values({
        userId,
        platform,
        externalUserId: `stub:${userId}`,
        displayName,
        accessTokenEnc: "stub",
      })
      .onConflictDoUpdate({
        target: [platformAccounts.userId, platformAccounts.platform],
        set: {
          displayName,
          updatedAt: sql`now()`,
        },
      });

    await markReferralPercentEligible(userId);
    return { ok: true, platform, status: "connected" };
  });
}

app.delete("/api/v1/platforms/:platform", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const platform = (req.params as { platform: string }).platform;
  await db
    .delete(platformAccounts)
    .where(
      and(
        eq(platformAccounts.userId, userId),
        eq(platformAccounts.platform, platform)
      )
    );
  return { ok: true };
});

app.get("/api/v1/games/fortune", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  return getFortuneStatus(userId);
});

app.get("/api/v1/games/fortune/config", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  void reply.header(
    "Cache-Control",
    "public, max-age=3600, stale-while-revalidate=86400"
  );
  return getFortuneConfigResponse();
});

app.get("/api/v1/games/fortune/state", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  void reply.header(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate"
  );
  return getFortuneStateResponse(userId);
});

const fortuneSpinBody = z.object({
  mode: z.enum(["free", "paid"]).optional(),
  platform: z.enum(["twitch", "kick"]),
});

app.post(
  "/api/v1/games/fortune/spin",
  {
    config: {
      rateLimit: {
        max: gameConfig.routeRateLimits.fortuneSpin.max,
        timeWindow: gameConfig.routeRateLimits.fortuneSpin.timeWindowMs,
      },
    },
  },
  async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = fortuneSpinBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: "Выберите платформу и режим." },
    });
  }
  const mode = parsed.data.mode === "paid" ? "paid" : "free";
  const res = await spinFortuneWheel(userId, mode, parsed.data.platform);
  if (!res.ok) {
    const fortuneMsg: Record<string, string> = {
      free_spin_used: "Бесплатное вращение на сегодня уже использовано",
      insufficient_coins: "Недостаточно монет на этом счёте",
      duplicate_spin: "Повторное вращение",
    };
    return reply.status(400).send({
      error: {
        code: res.error,
        message: fortuneMsg[res.error] ?? "Не удалось выполнить вращение",
      },
    });
  }
  return res;
  }
);

app.get("/api/v1/shop/items", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const pq = String(
    (req.query as { platform?: string }).platform ?? "twitch"
  ).toLowerCase();
  const shopPlatform = pq === "kick" ? "kick" : "twitch";
  void reply.header(
    "Cache-Control",
    "private, max-age=300, stale-while-revalidate=1800"
  );
  return await getShopClientBundle(shopPlatform);
});

const shopPurchaseBody = z.object({
  itemId: z.string().min(1),
  platform: z.enum(["twitch", "kick"]),
});

const streamTaskMessageBody = z.object({
  platform: z.enum(["twitch", "kick"]),
  text: z.string().min(2).max(500),
});

app.post("/api/v1/tasks/stream-message", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = streamTaskMessageBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: "Передайте platform и text" },
    });
  }
  const sec = await trackSecurityFingerprint({
    userId,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    deviceId: String(req.headers["x-device-id"] ?? ""),
  });
  if (sec.suspicious) {
    void enqueueFraudReviewJob({
      kind: "stream_message_blocked",
      userId,
      sharedUsers: sec.sharedUsers,
      ip: String(req.ip ?? ""),
      userAgent: String(req.headers["user-agent"] ?? ""),
      deviceId: String(req.headers["x-device-id"] ?? ""),
    });
    return reply.status(403).send({
      error: {
        code: "multi_account_suspected",
        message: "Подозрение на мультиаккаунт. Действие временно недоступно.",
      },
    });
  }
  const r = await registerStreamTaskMessage({
    userId,
    platform: parsed.data.platform,
    text: parsed.data.text,
  });
  if (!r.ok) {
    const map: Record<typeof r.code, number> = {
      not_live: 409,
      platform_mismatch: 409,
      watch_required: 403,
      too_frequent: 429,
      message_too_short: 400,
    };
    const msg: Record<typeof r.code, string> = {
      not_live: "Сейчас нет активного стрима",
      platform_mismatch: "Платформа сообщения не совпадает с текущим стримом",
      watch_required: "Сначала зайдите на стрим",
      too_frequent: "Не чаще 1 сообщения в минуту для зачёта",
      message_too_short: "Сообщение слишком короткое",
    };
    return reply.status(map[r.code]).send({ error: { code: r.code, message: msg[r.code] } });
  }
  return r;
});

const taskEvidenceBody = z.object({
  stage: z.number().int().min(1).max(2),
  images: z.array(z.string().min(10)).min(1).max(4),
  note: z.string().max(500).optional().nullable(),
});

function isValidEvidenceImage(raw: string): boolean {
  if (/^https?:\/\//i.test(raw)) return raw.length <= 2000;
  const dataUrl =
    /^data:image\/(png|pjpeg|jpeg|jpg|jpe|webp|heic|heif|gif);base64,/i.test(raw);
  /** ~2.5 МБ файл → data URL ≈ 3.5 МБ строки; запас на 4 скрина в одном запросе — bodyLimit. */
  return dataUrl && raw.length <= 6_500_000;
}

app.post("/api/v1/tasks/:id/evidence", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const taskId = (req.params as { id: string }).id;
  const parsed = taskEvidenceBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: "Неверный формат evidence" },
    });
  }
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    return reply.status(404).send({ error: { code: "task_not_found", message: "Задание не найдено" } });
  }
  const taskMeta = (task.meta as Record<string, unknown> | null) ?? null;
  if (!taskMeta || taskMeta.requiresEvidence !== true) {
    return reply.status(400).send({
      error: { code: "evidence_not_required", message: "Для этого задания evidence не требуется" },
    });
  }
  if (parsed.data.images.some((img) => !isValidEvidenceImage(img))) {
    return reply.status(400).send({
      error: { code: "invalid_image", message: "Разрешены только http(s) URL или data:image/* base64" },
    });
  }
  await db
    .insert(taskEvidence)
    .values({
      userId,
      taskId,
      stage: parsed.data.stage,
      images: parsed.data.images,
      note: parsed.data.note?.trim() || null,
      status: "submitted",
      adminNote: null,
      reviewedAt: null,
      reviewedBy: null,
    })
    .onConflictDoUpdate({
      target: [taskEvidence.userId, taskEvidence.taskId, taskEvidence.stage],
      set: {
        images: parsed.data.images,
        note: parsed.data.note?.trim() || null,
        status: "submitted",
        adminNote: null,
        reviewedAt: null,
        reviewedBy: null,
        updatedAt: sql`now()`,
      },
    });
  invalidateUserTaskDtoCache(userId);
  return { ok: true };
});

app.post("/api/v1/shop/purchase", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = shopPurchaseBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: "Выберите товар и платформу." },
    });
  }
  const { itemId, platform } = parsed.data;
  const res = await purchaseItem(userId, itemId, platform);
  if (!res.ok) {
    const shopMsg: Record<string, string> = {
      item_not_found: "Товар недоступен",
      insufficient_coins: "Недостаточно монет на этом счёте",
      duplicate: "Покупка уже была выполнена",
      out_of_stock: "Товар закончился",
    };
    return reply.status(400).send({
      error: {
        code: res.error,
        message: shopMsg[res.error] ?? "Не удалось выполнить покупку",
      },
    });
  }
  return res;
});

app.post("/api/v1/account/delete", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  await deleteUserAccount(userId);
  return { ok: true };
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await waitForDatabaseReady();
  await seedDefaultPointPlatforms();
  await warmupRedis();
  const stopPgPoolMetrics = startPgPoolMetrics(app.log);
  const stopEventLoopMonitor = startEventLoopMonitor(app.log);
  await startRealtimeSubscriber(app.log);
  const telegramPollStop: { current?: () => void } = {};
  app.addHook("onClose", async () => {
    stopPgPoolMetrics();
    stopEventLoopMonitor();
    telegramPollStop.current?.();
  });
  await app.listen({ port, host });
  app.log.info(`API http://${host}:${port}`);
  maybeStartTelegramLongPolling(app.log, (stop) => {
    telegramPollStop.current = stop;
  });
} catch (err) {
  app.log.error(err);
  captureException(err, { context: "startup" });
  process.exit(1);
}

async function gracefulShutdown(signal: string) {
  app.log.info({ signal }, "graceful_shutdown_start");
  try {
    await app.close();
  } catch (e) {
    app.log.error({ err: e }, "graceful_shutdown_error");
  }
  process.exit(0);
}
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

app.setErrorHandler((err: Error, req, reply) => {
  const statusCode = "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
  captureException(err, {
    route: req.url,
    method: req.method,
    requestId: req.id,
  });
  req.log.error({ err, requestId: req.id }, "unhandled_error");
  void reply.status(statusCode).send({
    error: {
      code: "internal_error",
      message: process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
    },
  });
});
