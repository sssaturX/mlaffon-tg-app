import type { FastifyInstance } from "fastify";
import { readMultipartImagePart } from "../lib/readMultipartImage.js";
import { authUser } from "../plugins/auth.js";
import { runMediaImageUpload } from "../services/mediaUploadService.js";

export async function registerMediaRoutes(app: FastifyInstance) {
  app.post("/api/v1/media/images", async (req, reply) => {
    const userId = authUser(req, reply);
    if (!userId) return;

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
    return result.data;
  });
}
