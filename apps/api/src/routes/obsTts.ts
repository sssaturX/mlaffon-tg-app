import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateSpeakerpyTts,
  isSpeakerpyVoice,
} from "../services/obsSpeakerTts.js";
import { getObsPurchaseWidgetSettings } from "../services/obsPurchaseWidget.js";

const ttsBody = z.object({
  token: z.string().min(20),
  text: z.string().min(1).max(600),
  voice: z.string().optional(),
  speed: z.number().min(0.75).max(1.5).optional(),
});

export async function registerObsTtsRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/obs/widget/tts",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: 60_000,
        },
      },
    },
    async (req, reply) => {
      const parsed = ttsBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "bad_request", message: parsed.error.message },
        });
      }

      const settings = await getObsPurchaseWidgetSettings();
      if (parsed.data.token !== settings.token) {
        return reply.status(403).send({
          error: { code: "invalid_token", message: "Invalid OBS widget token." },
        });
      }

      const requestedVoice = parsed.data.voice ?? settings.speakerpyVoice;
      const voice = isSpeakerpyVoice(requestedVoice)
        ? requestedVoice
        : settings.speakerpyVoice;
      const result = await generateSpeakerpyTts({
        text: parsed.data.text,
        voice,
        speed: parsed.data.speed,
      });

      if (!result.ok) {
        return reply.status(result.status).send({
          error: { code: result.code, message: result.message },
        });
      }

      void reply.header("Content-Type", result.contentType);
      void reply.header("Cache-Control", "private, max-age=86400");
      return reply.send(createReadStream(result.path));
    }
  );
}
