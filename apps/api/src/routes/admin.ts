import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  giveaways,
  appSettings,
  pointPlatforms,
  platformAccounts,
  predictionBets,
  promoCodes,
  users,
  userBalances,
  giveawayParticipants,
  taskEvidence,
  tasks,
  shopItems,
  dropUserStates,
  userStreamStreaks,
} from "../db/schema.js";
import {
  drawGiveawayWinners,
  getGiveawayPublicDetail,
  getParticipantCountsForGiveawayIds,
  listGiveawayParticipantsWithUsernames,
} from "../services/giveaways.js";
import { publishGiveawaysRealtimeSnapshot } from "../services/giveawaysRealtime.js";
import {
  getAdminDropStatus,
  getDropClaimantsAdmin,
  listDropsHistory,
  startDrop,
} from "../services/drops.js";
import {
  createTaskAdmin,
  listTasksAdmin,
  setTaskActive,
  deleteTaskAdmin,
  updateTaskAdmin,
} from "../services/adminTasks.js";
import {
  createShopItemAdmin,
  deleteShopItemAdmin,
  listShopItemsAdmin,
  updateShopItemAdmin,
} from "../services/adminShop.js";
import { listShopPurchasesAdmin } from "../services/shopPurchases.js";
import {
  getShopGlobalCopyForClient,
  setShopGlobalCopyAdmin,
} from "../services/shopSettings.js";
import { invalidateUserTaskDtoCache } from "../services/taskUserListCache.js";
import { signAdminToken, verifyAdminToken } from "../lib/adminJwt.js";
import {
  listBanAppealsAdmin,
  markBanAppealReviewed,
} from "../services/banAppeals.js";
import {
  startLiveBroadcast,
  endLiveBroadcast,
  getActiveLiveBroadcast,
} from "../services/liveBroadcast.js";
import { notifyTelegramLiveStarted } from "../services/telegramLiveNotify.js";
import { notifyWebPushLiveStarted } from "../services/webPush.js";
import {
  closePrediction,
  createPrediction,
  getPredictionById,
  listPredictionPlatforms,
  listPredictionsAdmin,
  pausePrediction,
  resolvePrediction,
  startPrediction,
} from "../services/predictions.js";
import { readMultipartImagePart } from "../lib/readMultipartImage.js";
import { readMultipartSoundPart } from "../lib/readMultipartSound.js";
import { mediaImageUploadResponseSchema } from "../lib/mediaImageJson.js";
import { runMediaImageUpload } from "../services/mediaUploadService.js";
import {
  getObsPurchaseWidgetSettings,
  type ObsPurchaseAlertEvent,
  publicWidgetSettings,
  regenerateObsPurchaseWidgetToken,
  updateObsPurchaseWidgetSettings,
  uploadObsWidgetSound,
} from "../services/obsPurchaseWidget.js";
import { publishObsWidgetEvent } from "../services/realtimePublish.js";
import {
  adminAdjustBalance,
  adminDeleteUser,
  adminListUserReferrals,
  adminUnlinkPlatform,
} from "../services/adminUserActions.js";
import { logAdminAction, listAuditLog } from "../services/adminAudit.js";
import { parsePagination } from "../lib/pagination.js";
import { hasPermission } from "../lib/adminRbac.js";
import { getPermissionsForRole } from "../lib/adminRbac.js";
import {
  verifyAdminCredentials,
  ensureSeedAdmin,
  listAdmins,
  createAdmin,
  updateAdminRole,
  deactivateAdmin,
} from "../services/adminAccounts.js";
import type { AdminRole } from "../db/schema.js";
import type { AdminTokenPayload } from "../lib/adminJwt.js";

function parseBearer(req: { headers: { authorization?: string } }): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7);
}

type AdminContext = AdminTokenPayload;

function requireAdmin(req: FastifyRequest, reply: FastifyReply): AdminContext | null {
  const token = parseBearer(req);
  if (!token) {
    reply.status(401).send({ error: { code: "unauthorized", message: "No token" } });
    return null;
  }
  try {
    return verifyAdminToken(token);
  } catch {
    reply.status(401).send({ error: { code: "unauthorized", message: "Invalid token" } });
    return null;
  }
}

function requirePermission(
  admin: AdminContext,
  perm: string,
  reply: FastifyReply
): boolean {
  if (!hasPermission(admin.role, perm)) {
    reply.status(403).send({
      error: { code: "forbidden", message: `Missing permission: ${perm}` },
    });
    return false;
  }
  return true;
}

function audit(
  admin: AdminContext,
  req: FastifyRequest,
  action: string,
  entityType: string,
  entityId?: string | null,
  payload?: Record<string, unknown> | null,
  success?: boolean
) {
  void logAdminAction({
    adminEmail: admin.email,
    action,
    entityType,
    entityId,
    payload,
    ip: req.ip,
    role: admin.role,
    requestId: req.id,
    success,
  });
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/api/admin/media/images", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:upload_media", reply)) return;
    const part = await readMultipartImagePart(req);
    if (!part.ok) {
      return reply.status(part.status).send({
        error: { code: part.code, message: part.message },
      });
    }
    const result = await runMediaImageUpload(part.buffer, req.log);
    if (!result.ok) {
      return reply.status(result.status).send({
        error: { code: result.code, message: result.message },
      });
    }
    audit(admin, req, "upload_media", "media", null, { url: result.data.fallbackSrc });
    return result.data;
  });

  const loginBody = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    passphrase: z.string().min(1),
  });

  await ensureSeedAdmin();

  app.post("/api/admin/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const { email, password, passphrase } = parsed.data;
    const result = await verifyAdminCredentials(email, password, passphrase);
    if (!result.ok) {
      void logAdminAction({
        adminEmail: email,
        action: "login_failed",
        entityType: "admin_session",
        ip: req.ip,
        requestId: req.id,
        success: false,
      });
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Invalid credentials" },
      });
    }
    const { admin } = result;
    void logAdminAction({
      adminEmail: admin.email,
      action: "login",
      entityType: "admin_session",
      ip: req.ip,
      role: admin.role,
      requestId: req.id,
    });
    return {
      token: signAdminToken(admin.email, admin.role as AdminRole, admin.id),
      role: admin.role,
      permissions: getPermissionsForRole(admin.role as AdminRole),
    };
  });

  app.get("/api/admin/me", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    return {
      email: admin.email,
      role: admin.role,
      permissions: getPermissionsForRole(admin.role),
    };
  });

  app.get("/api/admin/stats", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const [{ usersCount }] = await db
      .select({ usersCount: sql<number>`count(*)::int` })
      .from(users);
    const [{ coinsEarnedTotal }] = await db
      .select({
        coinsEarnedTotal: sql<number>`coalesce(sum(${userBalances.lifetimeEarned}), 0)::int`,
      })
      .from(userBalances);
    const [{ activeGiveaways }] = await db
      .select({ activeGiveaways: sql<number>`count(*)::int` })
      .from(giveaways)
      .where(and(eq(giveaways.active, true), isNull(giveaways.drawnAt)));
    const [{ giveawayEntriesTotal }] = await db
      .select({ giveawayEntriesTotal: sql<number>`count(*)::int` })
      .from(giveawayParticipants);
    return {
      usersCount: usersCount ?? 0,
      coinsEarnedTotal: coinsEarnedTotal ?? 0,
      activeGiveaways: activeGiveaways ?? 0,
      giveawayEntriesTotal: giveawayEntriesTotal ?? 0,
    };
  });

  app.get("/api/admin/users", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const q = req.query as { limit?: string; offset?: string; search?: string };
    const limit = Math.min(200, Math.max(1, Number.parseInt(q.limit ?? "50", 10) || 50));
    const offset = Math.max(0, Number.parseInt(q.offset ?? "0", 10) || 0);

    const rawSearch = typeof q.search === "string" ? q.search.trim().slice(0, 120) : "";
    const searchTerm = rawSearch.startsWith("@") ? rawSearch.slice(1).trim() : rawSearch;
    const searchWhere =
      searchTerm.length > 0
        ? or(ilike(users.username, `%${searchTerm}%`), ilike(users.firstName, `%${searchTerm}%`))
        : undefined;

    const [{ total }] = searchWhere
      ? await db
          .select({ total: sql<number>`count(*)::int` })
          .from(users)
          .where(searchWhere)
      : await db.select({ total: sql<number>`count(*)::int` }).from(users);

    const rows = await (() => {
      const base = db
        .select({
          id: users.id,
          telegramId: users.telegramId,
          username: users.username,
          firstName: users.firstName,
          createdAt: users.createdAt,
          banned: users.banned,
          banReason: users.banReason,
          multiAccountSuspected: users.multiAccountSuspected,
          multiAccountSuspectedAt: users.multiAccountSuspectedAt,
          multiAccountSharedUsers: users.multiAccountSharedUsers,
          coins: sql<number>`coalesce(${userBalances.coins}, 0)`,
          twitchCoins: sql<number>`coalesce(${userBalances.twitchCoins}, 0)`,
          kickCoins: sql<number>`coalesce(${userBalances.kickCoins}, 0)`,
          lifetimeEarned: sql<number>`coalesce(${userBalances.lifetimeEarned}, 0)`,
          twitchLifetimeEarned: sql<number>`coalesce(${userBalances.twitchLifetimeEarned}, 0)`,
          kickLifetimeEarned: sql<number>`coalesce(${userBalances.kickLifetimeEarned}, 0)`,
          streakTwitch: sql<number>`coalesce(${userStreamStreaks.twitchCurrent}, 0)`,
          streakKick: sql<number>`coalesce(${userStreamStreaks.kickCurrent}, 0)`,
        })
        .from(users)
        .leftJoin(userBalances, eq(users.id, userBalances.userId))
        .leftJoin(userStreamStreaks, eq(users.id, userStreamStreaks.userId));
      const filtered = searchWhere ? base.where(searchWhere) : base;
      return filtered.orderBy(desc(users.createdAt)).limit(limit).offset(offset);
    })();

    const refRows = await db
      .select({
        referrerId: users.referredById,
        c: sql<number>`count(*)::int`,
      })
      .from(users)
      .where(isNotNull(users.referredById))
      .groupBy(users.referredById);

    const refMap = new Map<string, number>();
    for (const r of refRows) {
      if (r.referrerId) refMap.set(r.referrerId, r.c ?? 0);
    }

    const userIds = rows.map((r) => r.id);
    type Plat = { linked: boolean; displayName: string | null };
    const platByUser = new Map<string, { twitch: Plat; kick: Plat }>();
    for (const id of userIds) {
      platByUser.set(id, {
        twitch: { linked: false, displayName: null },
        kick: { linked: false, displayName: null },
      });
    }
    if (userIds.length > 0) {
      const paRows = await db
        .select({
          userId: platformAccounts.userId,
          platform: platformAccounts.platform,
          displayName: platformAccounts.displayName,
        })
        .from(platformAccounts)
        .where(inArray(platformAccounts.userId, userIds));
      for (const p of paRows) {
        const slot = platByUser.get(p.userId);
        if (!slot) continue;
        const name = p.displayName?.trim() || null;
        if (p.platform === "twitch") {
          slot.twitch = { linked: true, displayName: name };
        } else if (p.platform === "kick") {
          slot.kick = { linked: true, displayName: name };
        }
      }
    }

    const dropCountMap = new Map<string, number>();
    const predCountMap = new Map<string, number>();
    if (userIds.length > 0) {
      const dc = await db
        .select({
          userId: dropUserStates.userId,
          c: sql<number>`count(*)::int`,
        })
        .from(dropUserStates)
        .where(
          and(
            inArray(dropUserStates.userId, userIds),
            eq(dropUserStates.won, true)
          )
        )
        .groupBy(dropUserStates.userId);
      for (const r of dc) dropCountMap.set(r.userId, r.c ?? 0);

      const pc = await db
        .select({
          userId: predictionBets.userId,
          c: sql<number>`count(*)::int`,
        })
        .from(predictionBets)
        .where(inArray(predictionBets.userId, userIds))
        .groupBy(predictionBets.userId);
      for (const r of pc) predCountMap.set(r.userId, r.c ?? 0);
    }

    return {
      total: total ?? 0,
      limit,
      offset,
      users: rows.map((u) => ({
        id: u.id,
        telegramId: String(u.telegramId),
        username: u.username,
        firstName: u.firstName,
        createdAt: u.createdAt.toISOString(),
        coins: u.coins,
        twitchCoins: u.twitchCoins,
        kickCoins: u.kickCoins,
        lifetimeEarned: u.lifetimeEarned,
        twitchLifetimeEarned: u.twitchLifetimeEarned,
        kickLifetimeEarned: u.kickLifetimeEarned,
        referralCount: refMap.get(u.id) ?? 0,
        banned: u.banned,
        banReason: u.banReason,
        multiAccountSuspected: u.multiAccountSuspected,
        multiAccountSuspectedAt: u.multiAccountSuspectedAt
          ? u.multiAccountSuspectedAt.toISOString()
          : null,
        multiAccountSharedUsers: u.multiAccountSharedUsers,
        streakTwitch: u.streakTwitch,
        streakKick: u.streakKick,
        dropsActivatedCount: dropCountMap.get(u.id) ?? 0,
        predictionsJoinedCount: predCountMap.get(u.id) ?? 0,
        platforms: platByUser.get(u.id) ?? {
          twitch: { linked: false, displayName: null },
          kick: { linked: false, displayName: null },
        },
      })),
    };
  });

  const patchUserBody = z.object({
    banned: z.boolean().optional(),
    banReason: z.string().max(500).nullable().optional(),
    multiAccountSuspected: z.boolean().optional(),
  });

  app.patch("/api/admin/users/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:ban_user", reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = patchUserBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const p = parsed.data;
    const patch: Record<string, unknown> = {};
    if (p.banned !== undefined) patch.banned = p.banned;
    if (p.banReason !== undefined) patch.banReason = p.banReason;
    if (p.multiAccountSuspected !== undefined) {
      patch.multiAccountSuspected = p.multiAccountSuspected;
      patch.multiAccountSuspectedAt = p.multiAccountSuspected ? sql`now()` : null;
      patch.multiAccountSharedUsers = p.multiAccountSuspected ? null : null;
    }
    if (Object.keys(patch).length === 0) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "Нет полей для обновления" },
      });
    }
    const [u] = await db
      .update(users)
      .set({
        ...(patch as { banned?: boolean; banReason?: string | null }),
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!u) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Пользователь не найден" },
      });
    }
    const action =
      p.multiAccountSuspected === false
        ? "clear_multi_account_suspected"
        : p.multiAccountSuspected === true
          ? "mark_multi_account_suspected"
          : p.banned
            ? "ban_user"
            : "update_user";
    audit(admin, req, action, "user", id, parsed.data);
    return { ok: true };
  });

  app.delete("/api/admin/users/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:delete_user", reply)) return;
    const id = (req.params as { id: string }).id;
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Пользователь не найден" },
      });
    }
    await adminDeleteUser(id);
    audit(admin, req, "delete_user", "user", id);
    return { ok: true };
  });

  const adjustBalanceBody = z.object({
    twitchDelta: z.number().int(),
    kickDelta: z.number().int(),
  });

  app.post("/api/admin/users/:id/balance", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:adjust_balance", reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = adjustBalanceBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Пользователь не найден" },
      });
    }
    const r = await adminAdjustBalance({
      targetUserId: id,
      twitchDelta: parsed.data.twitchDelta,
      kickDelta: parsed.data.kickDelta,
    });
    if (!r.ok) {
      const code = r.code === "insufficient" ? "insufficient_balance" : "no_change";
      const status = r.code === "insufficient" ? 400 : 400;
      return reply.status(status).send({
        error: {
          code,
          message:
            r.code === "insufficient"
              ? "Недостаточно монет на счёте для списания"
              : "Укажите ненулевую корректировку",
        },
      });
    }
    audit(admin, req, "adjust_balance", "user", id, parsed.data);
    return { ok: true };
  });

  app.delete("/api/admin/users/:id/platforms/:platform", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:delete_user", reply)) return;
    const id = (req.params as { id: string }).id;
    const platform = (req.params as { platform: string }).platform;
    if (platform !== "twitch" && platform !== "kick") {
      return reply.status(400).send({
        error: { code: "bad_platform", message: "Только twitch или kick" },
      });
    }
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Пользователь не найден" },
      });
    }
    const removed = await adminUnlinkPlatform(id, platform);
    if (!removed) {
      return reply.status(404).send({
        error: { code: "platform_not_linked", message: "Платформа не была привязана" },
      });
    }
    audit(admin, req, "unlink_platform", "user", id, { platform });
    return { ok: true };
  });

  app.get("/api/admin/users/:id/referrals", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const id = (req.params as { id: string }).id;
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!u) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Пользователь не найден" },
      });
    }
    const referralsList = await adminListUserReferrals(id);
    return { referrals: referralsList };
  });

  app.get("/api/admin/giveaways", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(giveaways);
    const rows = await db
      .select()
      .from(giveaways)
      .orderBy(desc(giveaways.sortOrder), desc(giveaways.endsAt))
      .limit(limit)
      .offset(offset);
    const counts = await getParticipantCountsForGiveawayIds(rows.map((r) => r.id));
    return {
      total,
      limit,
      offset,
      giveaways: rows.map((g) => ({
        id: g.id,
        title: g.title,
        prizeText: g.prizeText,
        description: g.description ?? null,
        imageUrl: g.imageUrl,
        imageMedia: g.imageMedia ?? null,
        endsAt: g.endsAt.toISOString(),
        active: g.active,
        sortOrder: g.sortOrder,
        winnerCount: g.winnerCount,
        ticketPriceCoins: g.ticketPriceCoins,
        drawnAt: g.drawnAt ? g.drawnAt.toISOString() : null,
        participantCount: counts.get(g.id) ?? 0,
        requireChannelSubscription: g.requireChannelSubscription,
        telegramChannelId: g.telegramChannelId ?? null,
        channelInviteUrl: g.channelInviteUrl ?? null,
        platform: g.platform ?? "both",
        winnerPickMode: (g.winnerPickMode ?? "random") as "random" | "predetermined",
        predeterminedWinnerUserIds: Array.isArray(g.predeterminedWinnerUserIds)
          ? g.predeterminedWinnerUserIds.filter(
              (x): x is string => typeof x === "string"
            )
          : null,
      })),
    };
  });

  const createGw = z
    .object({
      title: z.string().min(1),
      prizeText: z.string().min(1),
      description: z.string().optional().nullable(),
      imageUrl: z
        .union([z.string().url(), z.literal("")])
        .optional()
        .nullable(),
      imageMedia: mediaImageUploadResponseSchema.optional().nullable(),
      endsAt: z.string().datetime(),
      platform: z.enum(["twitch", "kick", "both"]).optional(),
      active: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      winnerCount: z.number().int().min(1).max(100).optional(),
      ticketPriceCoins: z.number().int().min(0).optional(),
      requireChannelSubscription: z.boolean().optional(),
      telegramChannelId: z.string().optional().nullable(),
      channelInviteUrl: z.string().optional().nullable(),
      winnerPickMode: z.enum(["random", "predetermined"]).optional(),
      predeterminedWinnerUserIds: z.array(z.string().uuid()).max(100).optional(),
    })
    .refine(
      (d) =>
        d.requireChannelSubscription !== true ||
        (Boolean(d.telegramChannelId?.trim()) && Boolean(d.channelInviteUrl?.trim())),
      {
        message:
          "При условии «подписка на канал» укажите ID канала (@username или -100…) и ссылку для пользователя",
        path: ["telegramChannelId"],
      }
    )
    .superRefine((d, ctx) => {
      const wc = d.winnerCount ?? 1;
      if (d.winnerPickMode !== "predetermined") return;
      const ids = d.predeterminedWinnerUserIds;
      if (!ids?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "В режиме «заданные победители» укажите хотя бы один UUID пользователя",
          path: ["predeterminedWinnerUserIds"],
        });
        return;
      }
      if (ids.length > wc) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Не больше ${wc} UUID — совпадает с числом победителей`,
          path: ["predeterminedWinnerUserIds"],
        });
      }
    })
    .superRefine((d, ctx) => {
      const endMs = new Date(d.endsAt).getTime();
      if (!Number.isFinite(endMs)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Некорректная дата окончания",
          path: ["endsAt"],
        });
        return;
      }
      /* Небольшой запас: часы клиента/сервера и задержка запроса. */
      if (endMs <= Date.now() + 2_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Дата окончания должна быть в будущем (по времени сервера). Если только что выставляли конец «через 5 минут», проверьте дату и часовой пояс в поле ниже.",
          path: ["endsAt"],
        });
      }
    });

  app.post("/api/admin/giveaways", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_giveaways", reply)) return;
    const parsed = createGw.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const d = parsed.data;
    const reqCh = d.requireChannelSubscription === true;
    const chId = d.telegramChannelId?.trim() ? d.telegramChannelId.trim() : null;
    let invUrl = d.channelInviteUrl?.trim() ? d.channelInviteUrl.trim() : null;
    if (invUrl && !/^https?:\/\//i.test(invUrl)) {
      invUrl = `https://${invUrl}`;
    }
    const imgUrl =
      d.imageUrl && d.imageUrl.trim().length > 0 ? d.imageUrl.trim() : null;
    const pickMode = d.winnerPickMode ?? "random";
    const presetRaw = d.predeterminedWinnerUserIds;
    const presetDeduped =
      pickMode === "predetermined" && presetRaw?.length
        ? [...new Set(presetRaw)]
        : null;
    const winnerPickMode =
      pickMode === "predetermined" && presetDeduped?.length
        ? "predetermined"
        : "random";
    const predeterminedWinnerUserIds =
      winnerPickMode === "predetermined" ? presetDeduped : null;
    const [ins] = await db
      .insert(giveaways)
      .values({
        title: d.title,
        prizeText: d.prizeText,
        description: d.description?.trim() ? d.description.trim() : null,
        imageUrl: imgUrl,
        imageMedia: d.imageMedia ?? null,
        endsAt: new Date(d.endsAt),
        platform: d.platform ?? "both",
        active: d.active ?? true,
        sortOrder: d.sortOrder ?? 0,
        winnerCount: d.winnerCount ?? 1,
        ticketPriceCoins: d.ticketPriceCoins ?? 0,
        requireChannelSubscription: reqCh,
        telegramChannelId: reqCh ? chId : null,
        channelInviteUrl: reqCh ? invUrl : null,
        winnerPickMode,
        predeterminedWinnerUserIds,
      })
      .returning({ id: giveaways.id });
    audit(admin, req, "create_giveaway", "giveaway", ins!.id, {
      title: d.title,
      winnerPickMode,
      predeterminedCount: predeterminedWinnerUserIds?.length ?? 0,
    });
    void publishGiveawaysRealtimeSnapshot();
    return { id: ins!.id };
  });

  app.get("/api/admin/giveaways/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const id = (req.params as { id: string }).id;
    const [g] = await db.select().from(giveaways).where(eq(giveaways.id, id)).limit(1);
    if (!g) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Розыгрыш не найден" },
      });
    }
    const participants = await listGiveawayParticipantsWithUsernames(id);
    const detail = await getGiveawayPublicDetail(id, null);
    return {
      giveaway: {
        id: g.id,
        title: g.title,
        prizeText: g.prizeText,
        description: g.description ?? null,
        imageUrl: g.imageUrl,
        imageMedia: g.imageMedia ?? null,
        endsAt: g.endsAt.toISOString(),
        active: g.active,
        sortOrder: g.sortOrder,
        winnerCount: g.winnerCount,
        ticketPriceCoins: g.ticketPriceCoins,
        drawnAt: g.drawnAt ? g.drawnAt.toISOString() : null,
        requireChannelSubscription: g.requireChannelSubscription,
        telegramChannelId: g.telegramChannelId ?? null,
        channelInviteUrl: g.channelInviteUrl ?? null,
        platform: g.platform ?? "both",
        winnerPickMode: (g.winnerPickMode ?? "random") as "random" | "predetermined",
        predeterminedWinnerUserIds: Array.isArray(g.predeterminedWinnerUserIds)
          ? g.predeterminedWinnerUserIds.filter(
              (x): x is string => typeof x === "string"
            )
          : null,
      },
      participants,
      publicSnapshot: detail,
    };
  });

  app.delete("/api/admin/giveaways/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_giveaways", reply)) return;
    const id = (req.params as { id: string }).id;
    const del = await db.delete(giveaways).where(eq(giveaways.id, id)).returning({ id: giveaways.id });
    if (del.length === 0) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Розыгрыш не найден" },
      });
    }
    audit(admin, req, "delete_giveaway", "giveaway", id);
    void publishGiveawaysRealtimeSnapshot();
    return { ok: true };
  });

  app.post("/api/admin/giveaways/:id/draw", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:draw_giveaway", reply)) return;
    const id = (req.params as { id: string }).id;
    const r = await drawGiveawayWinners(id);
    if (!r.ok) {
      const status: Record<typeof r.code, number> = {
        not_found: 404,
        already_drawn: 409,
        zero_winners: 400,
        no_participants: 400,
      };
      const messages: Record<typeof r.code, string> = {
        not_found: "Розыгрыш не найден",
        already_drawn: "Победители уже выбраны",
        zero_winners: "Число победителей должно быть ≥ 1",
        no_participants: "Нет участников — нечего разыгрывать",
      };
      return reply.status(status[r.code]).send({
        error: { code: r.code, message: messages[r.code] },
      });
    }
    audit(admin, req, "draw_giveaway", "giveaway", id, { winnerCount: r.winners.length });
    void publishGiveawaysRealtimeSnapshot();
    return { ok: true, winners: r.winners };
  });

  app.get("/api/admin/promos", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(promoCodes);
    const rows = await db
      .select()
      .from(promoCodes)
      .orderBy(desc(promoCodes.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      total,
      limit,
      offset,
      promos: rows.map((p) => ({
        id: p.id,
        displayName: p.displayName ?? null,
        code: p.code,
        rewardCoins: p.rewardCoins,
        creditPlatform: p.creditPlatform,
        maxUses: p.maxUses,
        usesCount: p.usesCount,
        active: p.active,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  });

  const createPromo = z.object({
    displayName: z.string().max(200).optional().nullable(),
    code: z.string().min(1),
    rewardCoins: z.number().int().min(0),
    maxUses: z.number().int().min(0),
    active: z.boolean().optional(),
    creditPlatform: z.enum(["split", "twitch", "kick"]).optional(),
  });

  app.post("/api/admin/promos", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_promos", reply)) return;
    const parsed = createPromo.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const code = parsed.data.code.trim().toUpperCase();
    try {
      const [ins] = await db
        .insert(promoCodes)
        .values({
          displayName: parsed.data.displayName?.trim()
            ? parsed.data.displayName.trim()
            : null,
          code,
          rewardCoins: parsed.data.rewardCoins,
          maxUses: parsed.data.maxUses,
          active: parsed.data.active ?? true,
          creditPlatform: parsed.data.creditPlatform ?? "split",
        })
        .returning({ id: promoCodes.id });
      audit(admin, req, "create_promo", "promo", ins!.id, { code });
      return { id: ins!.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return reply.status(409).send({
          error: { code: "promo_exists", message: "Промокод с таким кодом уже есть" },
        });
      }
      throw e;
    }
  });

  app.get("/api/admin/drops/history", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const q = req.query as { limit?: string; offset?: string };
    const lim = Math.min(200, Math.max(1, Number.parseInt(q.limit ?? "40", 10) || 40));
    const off = Math.max(0, Number.parseInt(q.offset ?? "0", 10) || 0);
    return listDropsHistory(lim, off);
  });

  app.get("/api/admin/drops/:id/claimants", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const id = (req.params as { id: string }).id;
    const data = await getDropClaimantsAdmin(id);
    if (!data) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Дроп не найден" },
      });
    }
    return data;
  });

  app.get("/api/admin/drops", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    return getAdminDropStatus();
  });

  const startDropBody = z
    .object({
      code: z.string().min(4).max(16),
      durationSeconds: z.number().int().min(5).max(86400),
      maxWinners: z.number().int().min(1).max(1_000_000),
      rewardMin: z.number().int().min(0),
      rewardMax: z.number().int().min(0),
      platform: z.enum(["twitch", "kick", "both"]).optional(),
    })
    .refine((d) => d.rewardMax >= d.rewardMin, {
      message: "rewardMax должен быть ≥ rewardMin",
      path: ["rewardMax"],
    });

  app.post("/api/admin/drops/start", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_drops", reply)) return;
    const parsed = startDropBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    try {
      const live = await getActiveLiveBroadcast();
      if (!live) {
        return reply.status(400).send({
          error: {
            code: "not_live",
            message:
              "Дроп можно запускать только во время эфира. Сначала начните стрим в разделе «Эфир».",
          },
        });
      }
      const platform = parsed.data.platform ?? "both";
      if (platform !== "both" && platform !== live.platform) {
        return reply.status(400).send({
          error: {
            code: "drop_platform_mismatch",
            message:
              "Платформа дропа должна совпадать с платформой текущего эфира (или выберите both).",
          },
        });
      }
      const { id } = await startDrop({
        ...parsed.data,
        platform,
      });
      audit(admin, req, "start_drop", "drop", id, { code: parsed.data.code, platform });
      return { ok: true, id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "code_invalid") {
        return reply.status(400).send({
          error: { code: "code_invalid", message: "Код — минимум 4 цифры" },
        });
      }
      throw e;
    }
  });

  const taskCreateBody = z
    .object({
      id: z.string().min(1).max(96),
      title: z.string().min(1),
      description: z.string(),
      reward: z.number().int().min(0),
      platform: z.enum(["twitch", "kick", "global", "telegram"]),
      type: z.enum(["daily", "one-time"]),
      validationType: z.enum(["api", "manual"]),
      meta: z.record(z.unknown()).nullable().optional(),
      active: z.boolean().optional(),
    })
    .refine(
      (d) => d.platform !== "telegram" || d.validationType === "manual",
      { message: "Для Telegram выберите ручную проверку (API пока не подключён)" }
    );

  const taskPatchBody = z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      reward: z.number().int().min(0).optional(),
      platform: z.enum(["twitch", "kick", "global", "telegram"]).optional(),
      type: z.enum(["daily", "one-time"]).optional(),
      validationType: z.enum(["api", "manual"]).optional(),
      meta: z.record(z.unknown()).nullable().optional(),
      active: z.boolean().optional(),
    })
    .refine(
      (d) =>
        !(
          d.platform === "telegram" &&
          d.validationType !== undefined &&
          d.validationType === "api"
        ),
      { message: "Для Telegram только ручная проверка" }
    );

  app.get("/api/admin/tasks", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const rows = await listTasksAdmin();
    return { tasks: rows };
  });

  app.get("/api/admin/tasks/evidence", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const q = req.query as { status?: string; limit?: string; offset?: string };
    const status = (q.status ?? "").trim();
    const { limit, offset } = parsePagination(q as Record<string, unknown>);
    const cond = status ? eq(taskEvidence.status, status) : sql`true`;
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(taskEvidence).where(cond);
    const rows = await db
      .select({
        id: taskEvidence.id,
        userId: taskEvidence.userId,
        taskId: taskEvidence.taskId,
        stage: taskEvidence.stage,
        status: taskEvidence.status,
        images: taskEvidence.images,
        note: taskEvidence.note,
        adminNote: taskEvidence.adminNote,
        reviewedAt: taskEvidence.reviewedAt,
        createdAt: taskEvidence.createdAt,
        taskTitle: tasks.title,
      })
      .from(taskEvidence)
      .innerJoin(tasks, eq(taskEvidence.taskId, tasks.id))
      .where(cond)
      .orderBy(desc(taskEvidence.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      total,
      limit,
      offset,
      evidence: rows.map((r) => ({
        ...r,
        reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  const reviewEvidenceBody = z.object({
    status: z.enum(["approved", "rejected"]),
    adminNote: z.string().max(1000).optional().nullable(),
  });

  app.patch("/api/admin/tasks/evidence/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:review_evidence", reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = reviewEvidenceBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "Передайте status и optional adminNote" },
      });
    }
    const [u] = await db
      .update(taskEvidence)
      .set({
        status: parsed.data.status,
        adminNote: parsed.data.adminNote?.trim() || null,
        reviewedBy: admin.email,
        reviewedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(taskEvidence.id, id))
      .returning({ id: taskEvidence.id, userId: taskEvidence.userId });
    if (!u) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Evidence не найден" },
      });
    }
    audit(admin, req, "review_evidence", "task_evidence", id, parsed.data);
    invalidateUserTaskDtoCache(u.userId);
    return { ok: true };
  });

  app.post("/api/admin/tasks", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_tasks", reply)) return;
    const parsed = taskCreateBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const d = parsed.data;
    try {
      await createTaskAdmin({
        id: d.id,
        title: d.title,
        description: d.description,
        reward: d.reward,
        platform: d.platform,
        type: d.type,
        validationType: d.validationType,
        meta: (d.meta ?? null) as Record<string, unknown> | null,
        active: d.active ?? true,
      });
      audit(admin, req, "create_task", "task", d.id, { title: d.title });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return reply.status(409).send({
          error: { code: "task_exists", message: "Задание с таким id уже есть" },
        });
      }
      throw e;
    }
  });

  app.put("/api/admin/tasks/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_tasks", reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = taskPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const ok = await updateTaskAdmin(id, parsed.data);
    if (!ok) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Задание не найдено" },
      });
    }
    audit(admin, req, "update_task", "task", id, parsed.data);
    return { ok: true };
  });

  app.delete("/api/admin/tasks/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_tasks", reply)) return;
    const id = (req.params as { id: string }).id;
    const ok = await deleteTaskAdmin(id);
    if (!ok) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Задание не найдено" },
      });
    }
    audit(admin, req, "delete_task", "task", id);
    return { ok: true };
  });

  app.patch("/api/admin/tasks/:id/toggle", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_tasks", reply)) return;
    const id = (req.params as { id: string }).id;
    const body = req.body as { active?: boolean } | undefined;
    const active = body?.active !== false;
    const ok = await setTaskActive(id, active);
    if (!ok) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Задание не найдено" },
      });
    }
    audit(admin, req, "toggle_task", "task", id, { active });
    return { ok: true, active };
  });

  const shopImageField = z
    .string()
    .max(6_500_000)
    .refine(
      (value) =>
        /^https?:\/\//i.test(value) ||
        /^data:image\/(png|pjpeg|jpeg|jpg|jpe|webp|heic|heif|gif);base64,/i.test(
          value
        ),
      "Разрешены только http(s) URL или data:image/* base64"
    );

  const shopKindZ = z.enum(["extra_spin", "manual_fulfillment"]);
  const shopPlatformZ = z.enum(["twitch", "kick", "both"]);

  const shopImageUrlIn = z.preprocess(
    (v) => (v === "" ? null : v),
    shopImageField.nullable().optional()
  );

  const shopCreateBody = z.object({
    id: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/i),
    title: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().optional(),
    imageUrl: shopImageUrlIn,
    imageMedia: mediaImageUploadResponseSchema.optional().nullable(),
    kind: shopKindZ,
    priceCoins: z.number().int().min(1),
    spins: z.number().int().min(1).max(99).optional(),
    subtitle: z.string().max(140).nullable().optional(),
    badgeText: z.string().max(60).nullable().optional(),
    buttonLabel: z.string().max(60).nullable().optional(),
    sortOrder: z.number().int().min(-999).max(999).optional(),
    /** Витрина: только Twitch, только Kick или обе (по умолчанию обе — как раньше). */
    platform: shopPlatformZ.optional().default("both"),
    active: z.boolean().optional(),
    stockTotal: z.union([z.number().int().min(1), z.null()]).optional(),
  });

  const shopPatchBody = z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    imageUrl: shopImageUrlIn,
    imageMedia: mediaImageUploadResponseSchema.optional().nullable(),
    kind: shopKindZ.optional(),
    priceCoins: z.number().int().min(1).optional(),
    spins: z.number().int().min(1).max(99).optional(),
    subtitle: z.string().max(140).nullable().optional(),
    badgeText: z.string().max(60).nullable().optional(),
    buttonLabel: z.string().max(60).nullable().optional(),
    sortOrder: z.number().int().min(-999).max(999).optional(),
    platform: shopPlatformZ.optional(),
    active: z.boolean().optional(),
    stockTotal: z.union([z.number().int().min(1), z.null()]).optional(),
  });

  app.get("/api/admin/shop/items", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const items = await listShopItemsAdmin();
    return { items };
  });

  app.post("/api/admin/shop/items", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_shop", reply)) return;
    const parsed = shopCreateBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const d = parsed.data;
    try {
      await createShopItemAdmin({
        id: d.id,
        title: d.title,
        description: d.description?.trim() ? d.description.trim() : null,
        imageUrl: d.imageUrl?.trim() ? d.imageUrl.trim() : null,
        kind: d.kind,
        priceCoins: d.priceCoins,
        meta: {
          ...(d.kind === "extra_spin" ? { spins: d.spins ?? 1 } : {}),
          subtitle: d.subtitle?.trim() ? d.subtitle.trim() : null,
          badgeText: d.badgeText?.trim() ? d.badgeText.trim() : null,
          buttonLabel: d.buttonLabel?.trim() ? d.buttonLabel.trim() : null,
          sortOrder: d.sortOrder ?? 0,
          ...(d.platform && d.platform !== "both" ? { platform: d.platform } : {}),
          ...(d.imageMedia ? { imageMedia: d.imageMedia } : {}),
        },
        active: d.active !== false,
        stockTotal: d.stockTotal === undefined ? null : d.stockTotal,
      });
      audit(admin, req, "create_shop_item", "shop_item", d.id, { title: d.title });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return reply.status(409).send({
          error: { code: "shop_exists", message: "Товар с таким id уже есть" },
        });
      }
      throw e;
    }
  });

  app.put("/api/admin/shop/items/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_shop", reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = shopPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const d = parsed.data;
    const patch: Parameters<typeof updateShopItemAdmin>[1] = {};
    if (d.title !== undefined) patch.title = d.title;
    if (d.description !== undefined)
      patch.description = d.description?.trim() ? d.description.trim() : null;
    if (d.imageUrl !== undefined)
      (patch as Record<string, unknown>).imageUrl = d.imageUrl?.trim() ? d.imageUrl.trim() : null;
    if (d.kind !== undefined) patch.kind = d.kind;
    if (d.priceCoins !== undefined) patch.priceCoins = d.priceCoins;
    if (d.active !== undefined) patch.active = d.active;
    if (d.stockTotal !== undefined) patch.stockTotal = d.stockTotal;

    const needsMetaMerge =
      d.spins !== undefined ||
      d.subtitle !== undefined ||
      d.badgeText !== undefined ||
      d.buttonLabel !== undefined ||
      d.sortOrder !== undefined ||
      d.platform !== undefined ||
      d.kind === "manual_fulfillment" ||
      d.imageMedia !== undefined;

    if (needsMetaMerge) {
      const [cur] = await db.select().from(shopItems).where(eq(shopItems.id, id)).limit(1);
      if (!cur) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Товар не найден" },
        });
      }
      const prev = (cur.meta && typeof cur.meta === "object" ? cur.meta : {}) as Record<
        string,
        unknown
      >;
      const nextMeta: Record<string, unknown> = {
        ...prev,
        ...(d.spins !== undefined ? { spins: d.spins } : {}),
        ...(d.subtitle !== undefined
          ? { subtitle: d.subtitle?.trim() ? d.subtitle.trim() : null }
          : {}),
        ...(d.badgeText !== undefined
          ? { badgeText: d.badgeText?.trim() ? d.badgeText.trim() : null }
          : {}),
        ...(d.buttonLabel !== undefined
          ? { buttonLabel: d.buttonLabel?.trim() ? d.buttonLabel.trim() : null }
          : {}),
        ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
      };
      const effectiveKind = d.kind ?? cur.kind;
      if (effectiveKind === "manual_fulfillment") {
        delete nextMeta.spins;
      }
      if (d.platform !== undefined) {
        if (d.platform === "both") delete nextMeta.platform;
        else nextMeta.platform = d.platform;
      }
      if (d.imageMedia !== undefined) {
        if (d.imageMedia == null) delete nextMeta.imageMedia;
        else nextMeta.imageMedia = d.imageMedia;
      }
      patch.meta = nextMeta;
    }

    try {
      const ok = await updateShopItemAdmin(id, patch);
      if (!ok) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Товар не найден" },
        });
      }
      audit(admin, req, "update_shop_item", "shop_item", id, d);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "stock_total_below_sold") {
        return reply.status(400).send({
          error: {
            code: "bad_stock",
            message: "Лимит не может быть меньше уже проданного количества",
          },
        });
      }
      throw e;
    }
  });

  app.delete("/api/admin/shop/items/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_shop", reply)) return;
    const id = (req.params as { id: string }).id;
    const del = await deleteShopItemAdmin(id);
    if (!del.ok) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Товар не найден" },
      });
    }
    audit(admin, req, "delete_shop_item", "shop_item", id);
    return { ok: true };
  });

  app.get("/api/admin/shop/purchases", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const q = req.query as { itemId?: string; limit?: string };
    const rawItem = q.itemId?.trim();
    const itemId = rawItem && rawItem.length > 0 ? rawItem : undefined;
    const lim = q.limit != null ? Number(q.limit) : 200;
    const purchases = await listShopPurchasesAdmin({
      itemId,
      limit: Number.isFinite(lim) ? lim : 200,
    });
    return { purchases };
  });

  app.get("/api/admin/shop/global-copy", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    return await getShopGlobalCopyForClient();
  });

  const shopGlobalCopyPutBody = z.object({
    notice: z.string().min(1).max(4000),
    warning: z.string().min(1).max(4000),
  });

  app.put("/api/admin/shop/global-copy", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_settings", reply)) return;
    const parsed = shopGlobalCopyPutBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    await setShopGlobalCopyAdmin({
      notice: parsed.data.notice.trim(),
      warning: parsed.data.warning.trim(),
    });
    audit(admin, req, "update_shop_global_copy", "settings", null, parsed.data);
    return { ok: true };
  });

  const obsWidgetSettingsBody = z.object({
    soundEnabled: z.boolean().optional(),
    soundUrl: z.string().url().nullable().optional(),
    defaultSound: z.enum(["soft", "spark", "bell"]).optional(),
    volume: z.number().min(0).max(1).optional(),
    position: z
      .enum(["bottom", "center", "top", "bottom-left", "bottom-right"])
      .optional(),
    durationMs: z.literal(10_000).optional(),
    showBuyerMessage: z.boolean().optional(),
    style: z.enum(["auto", "twitch", "kick", "neon", "minimal"]).optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    fontFamily: z.string().max(120).optional(),
  });

  app.get("/api/admin/obs/purchase-widget", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "read:shop", reply)) return;
    const settings = await getObsPurchaseWidgetSettings();
    return {
      ...settings,
      publicSettings: publicWidgetSettings(settings),
    };
  });

  app.put("/api/admin/obs/purchase-widget", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_shop", reply)) return;
    const parsed = obsWidgetSettingsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const settings = await updateObsPurchaseWidgetSettings(parsed.data);
    audit(admin, req, "update_obs_purchase_widget", "settings", null, parsed.data);
    return settings;
  });

  app.post("/api/admin/obs/purchase-widget/regenerate-token", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_shop", reply)) return;
    const settings = await regenerateObsPurchaseWidgetToken();
    audit(admin, req, "regenerate_obs_purchase_widget_token", "settings", null);
    return settings;
  });

  app.post("/api/admin/obs/purchase-widget/test", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_shop", reply)) return;
    const [settings, activeLive] = await Promise.all([
      getObsPurchaseWidgetSettings(),
      getActiveLiveBroadcast(),
    ]);
    const fallbackPlatform = settings.style === "kick" ? "kick" : "twitch";
    const streamPlatform =
      activeLive?.platform === "kick" || activeLive?.platform === "twitch"
        ? activeLive.platform
        : fallbackPlatform;
    const sentAt = new Date().toISOString();
    const event: ObsPurchaseAlertEvent = {
      type: "purchase_alert",
      v: 1,
      data: {
        buyerName: "Тестовый покупатель",
        buyerUsername: "test_user",
        productName: "Тестовый товар",
        productImage: null,
        price: 777,
        currency: streamPlatform === "twitch" ? "Twitch coins" : "Kick coins",
        buyerMessage: "Проверка OBS-виджета из админки",
        createdAt: sentAt,
        streamerId: settings.streamerId,
        purchasePlatform: streamPlatform,
        streamPlatform,
      },
    };
    await publishObsWidgetEvent(settings.streamerId, event);
    audit(admin, req, "test_obs_purchase_widget", "settings", null, {
      streamerId: settings.streamerId,
      streamPlatform,
    });
    return { ok: true, sentAt, streamerId: settings.streamerId };
  });

  app.post("/api/admin/obs/purchase-widget/sound", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_shop", reply)) return;
    const part = await readMultipartSoundPart(req);
    if (!part.ok) {
      return reply.status(part.status).send({
        error: { code: part.code, message: part.message },
      });
    }
    try {
      const uploaded = await uploadObsWidgetSound(part);
      if (!uploaded.ok) {
        return reply.status(uploaded.status).send({
          error: { code: uploaded.code, message: uploaded.message },
        });
      }
      const settings = await updateObsPurchaseWidgetSettings({
        soundUrl: uploaded.url,
        soundEnabled: true,
      });
      audit(admin, req, "upload_obs_purchase_widget_sound", "settings", null, {
        url: uploaded.url,
      });
      return settings;
    } catch (e) {
      req.log.error({ err: e }, "obs_widget_sound_upload_failed");
      return reply.status(503).send({
        error: { code: "storage_failed", message: "Не удалось сохранить звук." },
      });
    }
  });

  app.get("/api/admin/ban-appeals", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    return { appeals: await listBanAppealsAdmin() };
  });

  const patchAppealBody = z.object({
    adminNote: z.string().max(1000).nullable().optional(),
  });

  app.patch("/api/admin/ban-appeals/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:review_appeal", reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = patchAppealBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const ok = await markBanAppealReviewed(id, parsed.data.adminNote ?? null);
    if (!ok) {
      return reply.status(404).send({
        error: {
          code: "not_found",
          message: "Апелляция не найдена или уже обработана",
        },
      });
    }
    audit(admin, req, "review_ban_appeal", "ban_appeal", id, parsed.data);
    return { ok: true };
  });

  app.get("/api/admin/live-broadcast", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const b = await getActiveLiveBroadcast();
    if (!b) return { active: false as const };
    return {
      active: true as const,
      id: b.id,
      platform: b.platform,
      streamUrl: b.streamUrl,
      vpnNote: b.vpnNote,
      startedAt: b.startedAt.toISOString(),
    };
  });

  const liveStartBody = z.object({
    platform: z.enum(["twitch", "kick"]),
    streamUrl: z.string().min(8),
    vpnNote: z.string().max(500).optional().nullable(),
  });

  app.post("/api/admin/live-broadcast/start", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_live", reply)) return;
    const parsed = liveStartBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const r = await startLiveBroadcast({
      platform: parsed.data.platform,
      streamUrl: parsed.data.streamUrl,
      vpnNote: parsed.data.vpnNote,
    });
    if (!r.ok) {
      const status = r.code === "bad_url" ? 400 : 409;
      const msg =
        r.code === "bad_url"
          ? "Укажите ссылку с http:// или https://"
          : "Уже идёт эфир — завершите его перед новым";
      return reply.status(status).send({
        error: { code: r.code, message: msg },
      });
    }
    void notifyTelegramLiveStarted({
      platform: parsed.data.platform,
      streamUrl: parsed.data.streamUrl.trim(),
    }).catch((err) => {
      req.log.warn({ err }, "telegram_live_notify_failed");
    });
    void notifyWebPushLiveStarted(req.log).catch((err) => {
      req.log.warn({ err }, "web_push_live_notify_failed");
    });
    audit(admin, req, "start_live_broadcast", "live_broadcast", r.id, { platform: parsed.data.platform });
    return { ok: true, id: r.id };
  });

  app.post("/api/admin/live-broadcast/end", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_live", reply)) return;
    const r = await endLiveBroadcast();
    if (!r.ok) {
      return reply.status(400).send({
        error: { code: "not_live", message: "Нет активного эфира" },
      });
    }
    audit(admin, req, "end_live_broadcast", "live_broadcast");
    return { ok: true };
  });

  const createPredictionBody = z.object({
    title: z.string().min(1),
    optionA: z.string().min(1),
    optionB: z.string().min(1),
    platformType: z.string().min(1),
    bettingDurationSec: z.number().int().min(5).max(300),
    startAt: z.string().datetime().optional().nullable(),
    autoCloseAt: z.string().datetime().optional().nullable(),
  });

  app.get("/api/admin/predictions/platforms", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const rows = await listPredictionPlatforms(true);
    return { platforms: rows };
  });

  const patchPredictionPlatformBody = z.object({
    isActive: z.boolean(),
  });

  app.patch("/api/admin/predictions/platforms/:type", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_predictions", reply)) return;
    const type = (req.params as { type: string }).type;
    const parsed = patchPredictionPlatformBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "Передайте флаг isActive." },
      });
    }
    const [updated] = await db
      .update(pointPlatforms)
      .set({ isActive: parsed.data.isActive, updatedAt: sql`now()` })
      .where(eq(pointPlatforms.type, type))
      .returning({ id: pointPlatforms.id });
    if (!updated) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Платформа не найдена" },
      });
    }
    audit(admin, req, "toggle_prediction_platform", "prediction_platform", type, parsed.data);
    return { ok: true };
  });

  app.post("/api/admin/predictions", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_predictions", reply)) return;
    const parsed = createPredictionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const r = await createPrediction({
      ...parsed.data,
      createdBy: admin.email,
    });
    if (!r.ok) {
      return reply.status(400).send({
        error: { code: r.code, message: "Выберите активную платформу." },
      });
    }
    audit(admin, req, "create_prediction", "prediction", r.id, { title: parsed.data.title });
    return { id: r.id };
  });

  app.get("/api/admin/predictions", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    return { predictions: await listPredictionsAdmin() };
  });

  app.get("/api/admin/predictions/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const id = (req.params as { id: string }).id;
    const prediction = await getPredictionById(id, null);
    if (!prediction) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Предикт не найден" },
      });
    }
    return { prediction };
  });

  app.patch("/api/admin/predictions/:id/start", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_predictions", reply)) return;
    const id = (req.params as { id: string }).id;
    const r = await startPrediction(id);
    if (!r.ok) {
      const status = r.code === "not_found" ? 404 : 409;
      const message =
        r.code === "not_found"
          ? "Предикт не найден"
          : r.code === "another_active"
            ? "Уже есть активный предикт. Сначала закройте его."
            : "Нельзя запустить из текущего статуса";
      return reply.status(status).send({ error: { code: r.code, message } });
    }
    audit(admin, req, "start_prediction", "prediction", id);
    return { ok: true };
  });

  app.patch("/api/admin/predictions/:id/pause", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_predictions", reply)) return;
    const id = (req.params as { id: string }).id;
    const r = await pausePrediction(id);
    if (!r.ok) {
      const status = r.code === "not_found" ? 404 : 409;
      const message = r.code === "not_found" ? "Предикт не найден" : "Пауза доступна только для активного предикта";
      return reply.status(status).send({ error: { code: r.code, message } });
    }
    audit(admin, req, "pause_prediction", "prediction", id);
    return { ok: true };
  });

  app.patch("/api/admin/predictions/:id/close", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "mod:manage_predictions", reply)) return;
    const id = (req.params as { id: string }).id;
    const r = await closePrediction(id);
    if (!r.ok) {
      const status = r.code === "not_found" ? 404 : 409;
      const message = r.code === "not_found" ? "Предикт не найден" : "Нельзя закрыть из текущего статуса";
      return reply.status(status).send({ error: { code: r.code, message } });
    }
    audit(admin, req, "close_prediction", "prediction", id);
    return { ok: true };
  });

  const resolveBody = z.object({ winnerOption: z.enum(["A", "B"]) });

  app.patch("/api/admin/predictions/:id/resolve", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:resolve_prediction", reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = resolveBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "Выберите победивший исход." },
      });
    }
    const r = await resolvePrediction({ predictionId: id, winnerOption: parsed.data.winnerOption });
    if (!r.ok) {
      const status = r.code === "not_found" ? 404 : 409;
      const message = r.code === "not_found" ? "Предикт не найден" : "Сначала закройте предикт";
      return reply.status(status).send({ error: { code: r.code, message } });
    }
    audit(admin, req, "resolve_prediction", "prediction", id, parsed.data);
    return { ok: true };
  });

  // ── Admin management (super_admin only) ──────────────────────────

  app.get("/api/admin/admins", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_admins", reply)) return;
    const rows = await listAdmins();
    return { admins: rows };
  });

  const createAdminBody = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    passphrase: z.string().min(4),
    role: z.enum(["super_admin", "moderator", "viewer"]),
  });

  app.post("/api/admin/admins", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_admins", reply)) return;
    const parsed = createAdminBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    try {
      const result = await createAdmin(parsed.data);
      audit(admin, req, "create_admin", "admin", result.id, { email: parsed.data.email, role: parsed.data.role });
      return { ok: true, id: result.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return reply.status(409).send({
          error: { code: "admin_exists", message: "Admin with this email already exists" },
        });
      }
      throw e;
    }
  });

  app.patch("/api/admin/admins/:id/role", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_admins", reply)) return;
    const targetId = (req.params as { id: string }).id;
    const parsed = z.object({ role: z.enum(["super_admin", "moderator", "viewer"]) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "bad_request", message: parsed.error.message } });
    }
    if (targetId === admin.adminId) {
      return reply.status(400).send({
        error: { code: "self_modify", message: "Cannot change your own role" },
      });
    }
    const ok = await updateAdminRole(targetId, parsed.data.role as AdminRole);
    if (!ok) return reply.status(404).send({ error: { code: "not_found", message: "Admin not found" } });
    audit(admin, req, "update_admin_role", "admin", targetId, parsed.data);
    return { ok: true };
  });

  app.delete("/api/admin/admins/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "admin:manage_admins", reply)) return;
    const targetId = (req.params as { id: string }).id;
    if (targetId === admin.adminId) {
      return reply.status(400).send({
        error: { code: "self_modify", message: "Cannot deactivate yourself" },
      });
    }
    const ok = await deactivateAdmin(targetId);
    if (!ok) return reply.status(404).send({ error: { code: "not_found", message: "Admin not found" } });
    audit(admin, req, "deactivate_admin", "admin", targetId);
    return { ok: true };
  });

  // ── Audit log viewer ─────────────────────────────────────────────

  app.get("/api/admin/audit-log", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin || !requirePermission(admin, "read:audit", reply)) return;
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const result = await listAuditLog({ limit, offset });
    return { total: result.total, limit, offset, items: result.items };
  });
}
