import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authUser } from "../plugins/auth.js";
import {
  getGiveawayPublicDetail,
  joinGiveaway,
  listGiveawaysPublic,
} from "../services/giveaways.js";

export async function registerGiveawayRoutes(app: FastifyInstance) {
  app.get("/api/v1/giveaways", async () => {
    return { giveaways: await listGiveawaysPublic() };
  });

  app.get("/api/v1/giveaways/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const detail = await getGiveawayPublicDetail(id, req.userId ?? null);
    if (!detail) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Розыгрыш не найден" },
      });
    }
    return detail;
  });

  const joinBody = z.object({
    platform: z.enum(["twitch", "kick"]),
  });

  app.post("/api/v1/giveaways/:id/join", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;
    const id = (req.params as { id: string }).id;
    const parsed = joinBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "bad_request", message: parsed.error.message },
      });
    }
    const r = await joinGiveaway({
      giveawayId: id,
      userId,
      platform: parsed.data.platform,
    });
    if (!r.ok) {
      const status: Record<typeof r.code, number> = {
        not_found: 404,
        inactive: 400,
        ended: 400,
        already_drawn: 409,
        already_joined: 409,
        insufficient_coins: 400,
        duplicate_debit: 409,
        channel_not_subscribed: 403,
        channel_not_configured: 503,
      };
      const messages: Record<typeof r.code, string> = {
        not_found: "Розыгрыш не найден",
        inactive: "Розыгрыш неактивен",
        ended: "Розыгрыш уже завершён",
        already_drawn: "Победители уже выбраны",
        already_joined: "Вы уже участвуете",
        insufficient_coins: "Недостаточно монет на выбранной платформе",
        duplicate_debit: "Повторное списание",
        channel_not_subscribed:
          "Нужна подписка на канал: откройте ссылку в карточке розыгрыша и подпишитесь, затем снова нажмите «Участвовать»",
        channel_not_configured:
          "Проверка подписки недоступна (канал или бот не настроены). Обратитесь к администратору.",
      };
      return reply.status(status[r.code]).send({
        error: { code: r.code, message: messages[r.code] },
      });
    }
    return { ok: true, joinedAt: r.joinedAt };
  });
}
