import { z } from "zod";

export const taskMetaSchema = z
  .object({
    helix: z
      .object({
        kind: z.enum(["connected", "follow", "subscription"]),
        broadcaster_login: z.string().min(1).optional(),
      })
      .optional(),
    kick: z
      .object({
        kind: z.enum(["connected", "follow"]),
        channel_slug: z.string().min(1).optional(),
      })
      .optional(),
  })
  .optional();

export type TaskMeta = z.infer<typeof taskMetaSchema>;

export function parseTaskMeta(raw: unknown): TaskMeta {
  if (raw == null) return undefined;
  const p = taskMetaSchema.safeParse(raw);
  return p.success ? p.data : undefined;
}
