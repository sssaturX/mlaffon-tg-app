const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const AUTH_URL = "https://id.twitch.tv/oauth2/authorize";

export const TWITCH_DEFAULT_SCOPES = [
  "user:read:email",
  "user:read:subscriptions",
  "user:read:follows",
].join(" ");

export function buildTwitchAuthorizeUrl(params: {
  state: string;
  redirectUri: string;
}): string {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) throw new Error("TWITCH_CLIENT_ID missing");
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", TWITCH_DEFAULT_SCOPES);
  u.searchParams.set("state", params.state);
  u.searchParams.set("force_verify", "true");
  return u.toString();
}

export async function exchangeTwitchCode(code: string, redirectUri: string) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Twitch OAuth not configured");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string[] | string;
  };
  if (!r.ok) {
    throw new Error(
      `twitch_token_exchange_failed: ${JSON.stringify(j)}`
    );
  }
  if (!j.access_token) throw new Error("twitch_no_access_token");
  const scopes = Array.isArray(j.scope)
    ? j.scope
    : (j.scope?.split(/\s+/).filter(Boolean) ?? []);
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? null,
    expires_in: j.expires_in ?? 3600,
    scope: scopes,
  };
}

export async function refreshTwitchToken(refreshToken: string) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Twitch OAuth not configured");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string[] | string;
  };
  if (!r.ok) {
    throw new Error(`twitch_refresh_failed: ${JSON.stringify(j)}`);
  }
  if (!j.access_token) throw new Error("twitch_no_access_token");
  const scopes = Array.isArray(j.scope)
    ? j.scope
    : (j.scope?.split(/\s+/).filter(Boolean) ?? []);
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? null,
    expires_in: j.expires_in ?? 3600,
    scope: scopes,
  };
}
