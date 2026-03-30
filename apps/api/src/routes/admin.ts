import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { giveaways, appSettings } from "../db/schema.js";
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

  app.get("/api/admin/giveaways", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = await db
      .select()
      .from(giveaways)
      .orderBy(desc(giveaways.sortOrder), desc(giveaways.endsAt));
    return {
      giveaways: rows.map((g) => ({
        id: g.id,
        title: g.title,
        prizeText: g.prizeText,
        imageUrl: g.imageUrl,
        endsAt: g.endsAt.toISOString(),
        active: g.active,
        sortOrder: g.sortOrder,
      })),
    };
  });

  const createGw = z.object({
    title: z.string().min(1),
    prizeText: z.string().min(1),
    imageUrl: z.string().url().optional().nullable(),
    endsAt: z.string().datetime(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
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
        imageUrl: d.imageUrl ?? null,
        endsAt: new Date(d.endsAt),
        active: d.active ?? true,
        sortOrder: d.sortOrder ?? 0,
      })
      .returning({ id: giveaways.id });
    return { id: ins!.id };
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
}
