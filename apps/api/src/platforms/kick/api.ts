/**
 * Kick API — базовый URL может отличаться; при ошибке ответа проверка деградирует до «токен валиден».
 */
export async function kickValidateToken(accessToken: string): Promise<{
  id: string;
  username?: string;
} | null> {
  const base = process.env.KICK_API_BASE ?? "https://api.kick.com";
  const paths = ["/public/v1/users/me", "/v1/users/me"];

  for (const p of paths) {
    try {
      const r = await fetch(`${base}${p}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) continue;
      const j = (await r.json()) as {
        id?: string | number;
        user_id?: string | number;
        username?: string;
        slug?: string;
        data?: { id?: string; username?: string };
      };
      const id = String(
        j.id ?? j.user_id ?? j.data?.id ?? ""
      );
      if (id) {
        return {
          id,
          username: j.username ?? j.slug ?? j.data?.username,
        };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function kickCheckFollowChannel(
  accessToken: string,
  channelSlug: string
): Promise<boolean> {
  const base = process.env.KICK_API_BASE ?? "https://api.kick.com";
  const paths = [
    `/public/v1/channels/${encodeURIComponent(channelSlug)}/followers/me`,
    `/v1/channels/${encodeURIComponent(channelSlug)}/follow`,
  ];

  for (const p of paths) {
    try {
      const r = await fetch(`${base}${p}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.status === 200 || r.status === 204) return true;
      if (r.status === 404) return false;
    } catch {
      /* ignore */
    }
  }
  return false;
}
