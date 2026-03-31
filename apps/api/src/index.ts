import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { platformAccounts } from "./db/schema.js";
import {
  assertFreshAuth,
  parseInitData,
  verifyTelegramInitData,
} from "./lib/telegram.js";
import { signSession } from "./lib/jwt.js";
import {
  applyReferralFromStartParam,
  ensureUserFromTelegram,
  deleteUserAccount,
} from "./services/users.js";
import { buildMeResponse } from "./services/me.js";
import { createBanAppeal } from "./services/banAppeals.js";
import { listTasksForUser, claimTask } from "./services/tasks.js";
import { getLeaderboard, rankOfUser } from "./services/leaderboard.js";
import { referrals, users } from "./db/schema.js";
import { authUser, registerAuth } from "./plugins/auth.js";
import { gameConfig } from "./config.js";
import { getFortuneStatus, spinFortuneWheel } from "./services/fortune.js";
import { listShopItems, purchaseItem } from "./services/shop.js";
import { registerOAuthRoutes } from "./routes/oauth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerGiveawayRoutes } from "./routes/giveaways.js";
import { registerDropRoutes } from "./routes/drops.js";
import { buildHomePublicResponse } from "./services/homePublic.js";
import { applyPromoForUser } from "./services/promo.js";
import { assertClaimRateLimits } from "./lib/abuse.js";
import {
  getActiveLiveBroadcast,
  watchLiveBroadcast,
} from "./services/liveBroadcast.js";
import { markReferralPercentEligible } from "./services/referralEligibility.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(rateLimit, {
  max: gameConfig.rateLimit.maxPerWindow,
  timeWindow: gameConfig.rateLimit.timeWindowMs,
});

await registerAuth(app);
await registerOAuthRoutes(app);
await registerAdminRoutes(app);
await registerGiveawayRoutes(app);
await registerDropRoutes(app);

app.get("/health", async () => ({ ok: true }));

app.get("/api/v1/home/public", async () => buildHomePublicResponse());

const promoBody = z.object({
  code: z.string().min(1),
});

app.post("/api/v1/promo/apply", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = promoBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: parsed.error.message },
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
    };
    return reply.status(status[r.error] ?? 400).send({
      error: { code: r.error, message: r.error },
    });
  }
  return { ok: true, reward: r.reward };
});

const authBody = z.object({
  initData: z.string().min(1),
});

app.post("/api/v1/auth/telegram", async (req, reply) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return reply.status(500).send({
      error: { code: "server_misconfigured", message: "BOT_TOKEN missing" },
    });
  }

  const parsed = authBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: parsed.error.message },
    });
  }

  const { initData } = parsed.data;
  if (!verifyTelegramInitData(initData, botToken)) {
    return reply.status(401).send({
      error: { code: "invalid_init_data", message: "Bad Telegram signature" },
    });
  }

  const { user, startParam, authDate } = parseInitData(initData);
  assertFreshAuth(authDate);

  if (!user?.id) {
    return reply.status(400).send({
      error: { code: "no_user", message: "User missing in initData" },
    });
  }

  const { userId } = await ensureUserFromTelegram(user, startParam);
  await applyReferralFromStartParam(userId, BigInt(user.id), startParam);
  const token = signSession(userId, BigInt(user.id));

  return { token, userId };
});

if (process.env.ALLOW_DEV_AUTH === "1") {
  const devBody = z.object({
    telegramId: z.coerce.number().int().positive(),
    username: z.string().optional(),
  });
  app.post("/api/v1/auth/dev", async (req, reply) => {
    const parsed = devBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
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
  return buildMeResponse(userId);
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
      error: { code: "bad_request", message: parsed.error.message },
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
      error: { code: r.code, message: messages[r.code] },
    });
  }
  return { ok: true };
});

app.get("/api/v1/live-broadcast", async () => {
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
      error: { code: "bad_request", message: parsed.error.message },
    });
  }
  const lim = await assertClaimRateLimits(userId, req.ip);
  if (!lim.ok) {
    return reply.status(429).send({
      error: {
        code: "rate_limited",
        message:
          lim.reason === "ip" ? "Too many requests (IP)" : "Too many requests",
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
  const lim = await assertClaimRateLimits(userId, req.ip);
  if (!lim.ok) {
    return reply.status(429).send({
      error: {
        code: "rate_limited",
        message: lim.reason === "ip" ? "Too many requests (IP)" : "Too many requests",
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
      queue_unavailable: 503,
    };
    return reply.status(map[res.error] ?? 400).send({
      error: { code: res.error, message: res.error },
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
            u.username ?? u.firstName ?? `tg:${u.telegramId}`,
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
        u?.username ?? u?.firstName ?? (u ? String(u.telegramId) : "?"),
      createdAt: r.createdAt?.toISOString() ?? "",
      qualified: !!r.qualifiedAt,
    });
  }

  const qualifiedCount = invited.filter((i) => i.qualified).length;

  return {
    referralLink: me.referralLink,
    totalInvited: invited.length,
    qualifiedCount,
    invited,
  };
});

if (process.env.ALLOW_DEV_AUTH === "1") {
  app.post("/api/v1/platforms/:platform/connect", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const platform = (req.params as { platform: string }).platform;
    if (platform !== "twitch" && platform !== "kick") {
      return reply.status(400).send({
        error: { code: "bad_platform", message: "twitch or kick" },
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

app.post("/api/v1/games/fortune/spin", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = fortuneSpinBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: parsed.error.message },
    });
  }
  const mode = parsed.data.mode === "paid" ? "paid" : "free";
  const res = await spinFortuneWheel(userId, mode, parsed.data.platform);
  if (!res.ok) {
    return reply.status(400).send({
      error: { code: res.error, message: res.error },
    });
  }
  return res;
});

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

app.post("/api/v1/shop/purchase", async (req, reply) => {
  const userId = authUser(req, reply);
  if (!userId) return;
  const parsed = shopPurchaseBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: { code: "bad_request", message: parsed.error.message },
    });
  }
  const { itemId, platform } = parsed.data;
  const res = await purchaseItem(userId, itemId, platform);
  if (!res.ok) {
    return reply.status(400).send({
      error: { code: res.error, message: res.error },
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
  await app.listen({ port, host });
  app.log.info(`API http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
