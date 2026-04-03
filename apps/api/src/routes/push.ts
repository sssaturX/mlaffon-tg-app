import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authUser } from "../plugins/auth.js";
import {
  getVapidPublicKey,
  removePushSubscriptionByEndpoint,
  upsertPushSubscription,
} from "../services/webPush.js";

const subscribeBody = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  expirationTime: z.number().nullable().optional(),
});

const unsubscribeBody = z.object({
  endpoint: z.string().min(1),
});

export async function registerPushRoutes(app: FastifyInstance) {
  app.get("/api/v1/push/vapid-public-key", async () => ({
    publicKey: getVapidPublicKey(),
  }));

  app.post(
    "/api/v1/push/subscribe",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = authUser(req, reply);
      if (!userId) return;
      const parsed = subscribeBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "bad_request", message: parsed.error.message },
        });
      }
      if (!getVapidPublicKey()) {
        return reply.status(503).send({
          error: {
            code: "push_unavailable",
            message: "Push не настроен на сервере.",
          },
        });
      }
      try {
        await upsertPushSubscription(userId, parsed.data);
      } catch (e) {
        req.log.warn({ err: e }, "push_subscribe_failed");
        return reply.status(400).send({
          error: { code: "bad_request", message: "Некорректная подписка." },
        });
      }
      return { ok: true as const };
    }
  );

  app.delete(
    "/api/v1/push/subscribe",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = authUser(req, reply);
      if (!userId) return;
      const parsed = unsubscribeBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "bad_request", message: parsed.error.message },
        });
      }
      await removePushSubscriptionByEndpoint(userId, parsed.data.endpoint);
      return { ok: true as const };
    }
  );
}
