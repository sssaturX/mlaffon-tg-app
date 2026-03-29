const HELIX = "https://api.twitch.tv/helix";

function clientId(): string {
  const id = process.env.TWITCH_CLIENT_ID;
  if (!id) throw new Error("TWITCH_CLIENT_ID missing");
  return id;
}

async function helix(
  accessToken: string,
  path: string,
  search?: Record<string, string>
): Promise<Response> {
  const u = new URL(`${HELIX}${path}`);
  if (search) {
    for (const [k, v] of Object.entries(search)) {
      u.searchParams.set(k, v);
    }
  }
  return fetch(u, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId(),
    },
  });
}

export async function helixGetOwnUser(accessToken: string): Promise<{
  id: string;
  login: string;
  display_name: string;
} | null> {
  const r = await helix(accessToken, "/users");
  const j = (await r.json()) as {
    data?: { id: string; login: string; display_name: string }[];
  };
  if (!r.ok) return null;
  return j.data?.[0] ?? null;
}

export async function helixGetUserIdByLogin(
  accessToken: string,
  login: string
): Promise<string | null> {
  const r = await helix(accessToken, "/users", { login });
  const j = (await r.json()) as { data?: { id: string }[] };
  if (!r.ok) return null;
  return j.data?.[0]?.id ?? null;
}

/** Пользователь accessToken подписан на broadcaster_login */
export async function helixCheckSubscription(
  accessToken: string,
  userId: string,
  broadcasterLogin: string
): Promise<boolean> {
  const broadcasterId = await helixGetUserIdByLogin(
    accessToken,
    broadcasterLogin.toLowerCase()
  );
  if (!broadcasterId) return false;

  const r = await helix(accessToken, "/subscriptions/user", {
    broadcaster_id: broadcasterId,
    user_id: userId,
  });
  if (r.status === 404) return false;
  const j = (await r.json()) as { data?: { tier?: string }[] };
  if (!r.ok) return false;
  return Array.isArray(j.data) && j.data.length > 0;
}

/** user_id подписан на канал broadcaster_login (Helix channels/followed) */
export async function helixCheckFollow(
  accessToken: string,
  userId: string,
  broadcasterLogin: string
): Promise<boolean> {
  const broadcasterId = await helixGetUserIdByLogin(
    accessToken,
    broadcasterLogin.toLowerCase()
  );
  if (!broadcasterId) return false;

  const r = await helix(accessToken, "/channels/followed", {
    user_id: userId,
    broadcaster_id: broadcasterId,
  });
  if (!r.ok) return false;
  const j = (await r.json()) as {
    data?: { broadcaster_id?: string }[];
    total?: number;
  };
  return (j.total ?? 0) > 0 || (j.data?.length ?? 0) > 0;
}
