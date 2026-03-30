import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  giveaways,
  appSettings,
  promoCodes,
  users,
  userBalances,
  giveawayParticipants,
} from "../db/schema.js";
import {
  drawGiveawayWinners,
  getGiveawayPublicDetail,
  getParticipantCountsForGiveawayIds,
  listGiveawayParticipantsWithUsernames,
} from "../services/giveaways.js";
import { signAdminToken, verifyAdminToken } from "../lib/adminJwt.js";

function parseBearer(req: { headers: { authorization?: string } }): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7);
}

function requireAdmin(req: FastifyRequest, reply: FastifyReply): string | null {
  const token = parseBearer(req);
  if (!token) {
    reply.status(401).send({ error: { code: "unauthorized", message: "No token" } });
    return null;
  }
  try {
    return verifyAdminToken(token).email;
  } catch {
    reply.status(401).send({ error: { code: "unauthorized", message: "Invalid token" } });
    return null;
  }
}

export async function registerAdminRoutes(app: FastifyInstance) {
  const loginBody = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    passphrase: z.string().min(1),
  });

  app.post("/api/admin/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const { email, password, passphrase } = parsed.data;
    const okEmail = process.env.ADMIN_EMAIL;
    const okPass = process.env.ADMIN_PASSWORD;
    const okPhrase = process.env.ADMIN_PASSPHRASE;
    if (!okEmail || !okPass || !okPhrase) {
      return reply.status(503).send({
        error: { code: "admin_misconfigured", message: "Admin env not set" },
      });
    }
    if (email !== okEmail || password !== okPass || passphrase !== okPhrase) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Invalid credentials" },
      });
    }
    return { token: signAdminToken(email) };
  });

  app.get("/api/admin/stats", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
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
      .where(eq(giveaways.active, true));
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

  app.get("/api/admin/giveaways", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = await db
      .select()
      .from(giveaways)
      .orderBy(desc(giveaways.sortOrder), desc(giveaways.endsAt));
    const counts = await getParticipantCountsForGiveawayIds(rows.map((r) => r.id));
    return {
      giveaways: rows.map((g) => ({
        id: g.id,
        title: g.title,
        prizeText: g.prizeText,
        description: g.description ?? null,
        imageUrl: g.imageUrl,
        endsAt: g.endsAt.toISOString(),
        active: g.active,
        sortOrder: g.sortOrder,
        winnerCount: g.winnerCount,
        ticketPriceCoins: g.ticketPriceCoins,
        drawnAt: g.drawnAt ? g.drawnAt.toISOString() : null,
        participantCount: counts.get(g.id) ?? 0,
      })),
    };
  });

  const createGw = z.object({
    title: z.string().min(1),
    prizeText: z.string().min(1),
    description: z.string().optional().nullable(),
    imageUrl: z.string().url().optional().nullable(),
    endsAt: z.string().datetime(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    winnerCount: z.number().int().min(1).max(100).optional(),
    ticketPriceCoins: z.number().int().min(0).optional(),
  });

  app.post("/api/admin/giveaways", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const parsed = createGw.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const d = parsed.data;
    const [ins] = await db
      .insert(giveaways)
      .values({
        title: d.title,
        prizeText: d.prizeText,
        description: d.description?.trim() ? d.description.trim() : null,
        imageUrl: d.imageUrl ?? null,
        endsAt: new Date(d.endsAt),
        active: d.active ?? true,
        sortOrder: d.sortOrder ?? 0,
        winnerCount: d.winnerCount ?? 1,
        ticketPriceCoins: d.ticketPriceCoins ?? 0,
      })
      .returning({ id: giveaways.id });
    return { id: ins!.id };
  });

  app.get("/api/admin/giveaways/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
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
        endsAt: g.endsAt.toISOString(),
        active: g.active,
        sortOrder: g.sortOrder,
        winnerCount: g.winnerCount,
        ticketPriceCoins: g.ticketPriceCoins,
        drawnAt: g.drawnAt ? g.drawnAt.toISOString() : null,
      },
      participants,
      publicSnapshot: detail,
    };
  });

  app.delete("/api/admin/giveaways/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const del = await db.delete(giveaways).where(eq(giveaways.id, id)).returning({ id: giveaways.id });
    if (del.length === 0) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Розыгрыш не найден" },
      });
    }
    return { ok: true };
  });

  app.post("/api/admin/giveaways/:id/draw", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const r = await drawGiveawayWinners(id);
    if (!r.ok) {
      const status: Record<typeof r.code, number> = {
        not_found: 404,
        already_drawn: 409,
        not_enough_participants: 400,
        zero_winners: 400,
      };
      const messages: Record<typeof r.code, string> = {
        not_found: "Розыгрыш не найден",
        already_drawn: "Победители уже выбраны",
        not_enough_participants: "Недостаточно участников для выбранного числа победителей",
        zero_winners: "Число победителей должно быть ≥ 1",
      };
      return reply.status(status[r.code]).send({
        error: { code: r.code, message: messages[r.code] },
      });
    }
    return { ok: true, winners: r.winners };
  });

  const patchCashback = z.object({
    enabled: z.boolean(),
    title: z.string().min(1),
    imageUrl: z.string().url().optional().nullable(),
    body: z.string().min(1),
  });

  app.put("/api/admin/settings/cashback", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const parsed = patchCashback.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    await db
      .insert(appSettings)
      .values({
        key: "cashback",
        value: parsed.data,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: parsed.data, updatedAt: sql`now()` },
      });
    return { ok: true };
  });

  app.get("/api/admin/promos", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = await db
      .select()
      .from(promoCodes)
      .orderBy(desc(promoCodes.createdAt));
    return {
      promos: rows.map((p) => ({
        id: p.id,
        code: p.code,
        rewardCoins: p.rewardCoins,
        maxUses: p.maxUses,
        usesCount: p.usesCount,
        active: p.active,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  });

  const createPromo = z.object({
    code: z.string().min(1),
    rewardCoins: z.number().int().positive(),
    maxUses: z.number().int().min(0),
    active: z.boolean().optional(),
  });

  app.post("/api/admin/promos", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
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
          code,
          rewardCoins: parsed.data.rewardCoins,
          maxUses: parsed.data.maxUses,
          active: parsed.data.active ?? true,
        })
        .returning({ id: promoCodes.id });
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
}
