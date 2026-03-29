const TOKEN_URL = "https://id.kick.com/oauth/token";
const AUTH_URL = "https://id.kick.com/oauth/authorize";

export const KICK_DEFAULT_SCOPES = [
  "user:read",
  "channel:read",
  "channel:subscribe",
].join(" ");

export function buildKickAuthorizeUrl(params: {
  state: string;
  redirectUri: string;
  codeChallenge: string;
}): string {
  const clientId = process.env.KICK_CLIENT_ID;
  if (!clientId) throw new Error("KICK_CLIENT_ID missing");
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", KICK_DEFAULT_SCOPES);
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge", params.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export async function exchangeKickCode(
  code: string,
  redirectUri: string,
  codeVerifier: string
) {
  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Kick OAuth not configured");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
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
    scope?: string;
  };
  if (!r.ok) {
    throw new Error(`kick_token_exchange_failed: ${JSON.stringify(j)}`);
  }
  if (!j.access_token) throw new Error("kick_no_access_token");
  const scopes = j.scope ? j.scope.split(" ") : [];
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? null,
    expires_in: j.expires_in ?? 3600,
    scope: scopes,
  };
}

export async function refreshKickToken(refreshToken: string) {
  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Kick OAuth not configured");

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
    scope?: string;
  };
  if (!r.ok) {
    throw new Error(`kick_refresh_failed: ${JSON.stringify(j)}`);
  }
  if (!j.access_token) throw new Error("kick_no_access_token");
  const scopes = j.scope ? j.scope.split(" ") : [];
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? null,
    expires_in: j.expires_in ?? 3600,
    scope: scopes,
  };
}
