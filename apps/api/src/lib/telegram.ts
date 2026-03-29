import crypto from "node:crypto";

const MAX_AUTH_AGE_SEC = 86400;

export interface TelegramUserPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string
): boolean {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const calculated = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  return calculated === hash;
}

export function parseInitData(initData: string): {
  user: TelegramUserPayload | null;
  startParam: string | null;
  authDate: number | null;
} {
  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");
  const authDateRaw = params.get("auth_date");
  let user: TelegramUserPayload | null = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as TelegramUserPayload;
    } catch {
      user = null;
    }
  }
  const authDate = authDateRaw ? Number(authDateRaw) : null;
  const startParam =
    params.get("start_param") ?? params.get("startattach") ?? null;
  return { user, startParam, authDate };
}

export function assertFreshAuth(authDate: number | null): void {
  if (authDate == null) throw new Error("missing_auth_date");
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > MAX_AUTH_AGE_SEC) throw new Error("init_data_expired");
}
