import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db, waitForDatabaseReady } from "./db/index.js";
import { platformAccounts } from "./db/schema.js";
import {
  assertFreshAuth,
  parseInitData,
  verifyTelegramInitData,
} from "./lib/telegram.js";
import { signSession } from "./lib/jwt.js";
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
import { buildMeEconomyPatch, buildMeResponse } from "./services/me.js";
import { createBanAppeal } from "./services/banAppeals.js";
import { listTasksForUser, claimTask } from "./services/tasks.js";
import { registerStreamTaskMessage } from "./services/taskStreamMessages.js";
import { getLeaderboard, rankOfUser } from "./services/leaderboard.js";
import { referrals, users } from "./db/schema.js";
import { authUser, registerAuth } from "./plugins/auth.js";
import { gameConfig } from "./config.js";
import { getFortuneStatus, spinFortuneWheel } from "./services/fortune.js";
import { listShopItems, purchaseItem } from "./services/shop.js";
import { registerOAuthRoutes } from "./routes/oauth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerGiveawayRoutes } from "./routes/giveaways.js";
import { registerPredictionRoutes } from "./routes/predictions.js";
import { registerDropRoutes } from "./routes/drops.js";
import { registerPushRoutes } from "./routes/push.js";
import { buildHomePublicResponse } from "./services/homePublic.js";
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
import { closeExpiredPredictionsNow } from "./services/predictions.js";
import { trackSecurityFingerprint } from "./services/securitySignals.js";
import { taskEvidence, tasks } from "./db/schema.js";

const app = Fastify({ logger: true });
let predictionTimerCloser: NodeJS.Timeout | null = null;

await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(rateLimit, {
  max: gameConfig.rateLimit.maxPerWindow,
  timeWindow: gameConfig.rateLimit.timeWindowMs,
  allowList: (req) => {
    const p = req.url.split("?")[0] ?? "";
    if (p === "/api/v1/ws" || p === "/health") return true;
    return false;
  },
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const payload = auth.slice(7).split(".")[1];
        if (payload) {
          const decoded = JSON.parse(
            Buffer.from(payload, "base64url").toString()
          ) as { sub?: string };
          if (decoded.sub) return `user:${decoded.sub}`;
        }
      } catch {
        /* fall through to IP */
      }
    }
    return req.ip;
  },
});

await app.register(websocket);

await registerAuth(app);

app.get("/api/v1/ws", { websocket: true }, (socket, req) => {
  void handleRealtimeWsConnection(socket, req.url);
});
await registerOAuthRoutes(app);
await registerAdminRoutes(app);
await registerGiveawayRoutes(app);
await registerPredictionRoutes(app);
await registerDropRoutes(app);
await registerPushRoutes(app);

app.get("/health", async () => ({ ok: true }));

app.get("/api/v1/home/public", async () => buildHomePublicResponse());

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
  return { ok: true, reward: r.reward, economy: r.economy };
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

app.post("/api/v1/auth/register", async (req, reply) => {
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
});

app.post("/api/v1/auth/login", async (req, reply) => {
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
});

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
  const economy = await buildMeEconomyPatch(userId);
  return {
    ok: true,
    platform: res.platform,
    streak: res.streak,
    streakIncremented: res.streakIncremented,
    alreadyWatchedThisBroadcast: res.alreadyWatchedThisBroadcast,
    bonusCoinsAwarded: res.bonusCoinsAwarded,
    economy,
  };
});

app.get("/api/v1/tasks", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const platform = String(
    (req.query as { platform?: string }).platform ?? "all"
  );
  let list = await listTasksForUser(userId);
  if (platform === "twitch" || platform === "kick") {
    list = list.filter(
      (t) =>
        t.platform === platform ||
        t.platform === "global" ||
        t.platform === "telegram"
    );
  } else if (platform === "global") {
    list = list.filter((t) => t.platform === "global");
  }
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
  return { ok: true, coins: res.coins, reward: res.reward };
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

  return { sort, platform, top: entries, me: meEntry };
});

app.get("/api/v1/referrals", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const me = await buildMeResponse(userId);
  const rows = await db
    .select({
      refereeId: referrals.refereeId,
      createdAt: referrals.createdAt,
      qualifiedAt: referrals.qualifiedAt,
    })
    .from(referrals)
    .where(eq(referrals.referrerId, userId));

  const invited = [];
  for (const r of rows) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, r.refereeId))
      .limit(1);
    invited.push({
      refereeId: r.refereeId,
      displayName:
        u?.username ??
        u?.firstName ??
        (u
          ? u.telegramId != null
            ? String(u.telegramId)
            : (u.email ?? "?")
          : "?"),
      createdAt: r.createdAt?.toISOString() ?? "",
      qualified: !!r.qualifiedAt,
    });
  }

  const qualifiedCount = invited.filter((i) => i.qualified).length;

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
  const items = await listShopItems();
  return { items };
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
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(raw) && raw.length <= 4_000_000;
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
  await startRealtimeSubscriber(app.log);
  predictionTimerCloser = setInterval(() => {
    void closeExpiredPredictionsNow().catch((err) => {
      app.log.warn({ err }, "prediction_auto_close_failed");
    });
  }, 1000);
  predictionTimerCloser.unref();
  app.addHook("onClose", async () => {
    if (predictionTimerCloser) {
      clearInterval(predictionTimerCloser);
      predictionTimerCloser = null;
    }
  });
  await app.listen({ port, host });
  app.log.info(`API http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
