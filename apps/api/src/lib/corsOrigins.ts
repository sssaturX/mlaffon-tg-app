import type { FastifyCorsOptions } from "@fastify/cors";

function splitOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Production: strict allowlist from `CORS_ORIGINS` and/or `PUBLIC_WEB_URL` / `PUBLIC_ADMIN_URL`.
 * Development: `CORS_ORIGINS` if set, otherwise localhost:5173 + localhost:5174.
 * Never reflects arbitrary origins — prevents credential theft on staging/preview deploys.
 */
export function resolveCorsOrigin(): FastifyCorsOptions["origin"] {
  const isProd = process.env.NODE_ENV === "production";
  const corsOriginsRaw = process.env.CORS_ORIGINS?.trim();

  if (!isProd) {
    if (corsOriginsRaw) return splitOrigins(corsOriginsRaw);
    const devOrigins = ["http://localhost:5173", "http://localhost:5174"];
    const pub = process.env.PUBLIC_WEB_URL?.trim().replace(/\/+$/, "");
    if (pub && !devOrigins.includes(pub)) devOrigins.push(pub);
    return devOrigins;
  }

  const list: string[] = [];
  if (corsOriginsRaw) list.push(...splitOrigins(corsOriginsRaw));

  const pub = process.env.PUBLIC_WEB_URL?.trim().replace(/\/+$/, "");
  if (pub && !list.includes(pub)) list.push(pub);

  const admin = process.env.PUBLIC_ADMIN_URL?.trim().replace(/\/+$/, "");
  if (admin && !list.includes(admin)) list.push(admin);

  if (list.length === 0) {
    throw new Error(
      "[cors] NODE_ENV=production requires CORS_ORIGINS and/or PUBLIC_WEB_URL / PUBLIC_ADMIN_URL."
    );
  }

  return list;
}
