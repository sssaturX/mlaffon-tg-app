/**
 * Kick API — базовый URL может отличаться; при ошибке ответа проверка деградирует до «токен валиден».
 */
export async function kickValidateToken(accessToken: string): Promise<{
  id: string;
  username?: string;
  avatarUrl?: string;
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
        profile_picture?: string;
        profile_picture_url?: string;
        avatar?: string;
        data?: { id?: string; username?: string; profile_picture?: string };
      };
      const id = String(
        j.id ?? j.user_id ?? j.data?.id ?? ""
      );
      if (id) {
        const avatarUrl =
          j.profile_picture ??
          j.profile_picture_url ??
          j.avatar ??
          j.data?.profile_picture ??
          undefined;
        return {
          id,
          username: j.username ?? j.slug ?? j.data?.username,
          avatarUrl,
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

/**
 * Публичная проверка: канал в эфире (без OAuth зрителя).
 * Формат ответа Kick может меняться — проверяем несколько полей.
 */
export async function kickIsChannelLive(channelSlug: string): Promise<boolean> {
  const slug = encodeURIComponent(channelSlug);
  const urls = [
    `https://kick.com/api/v2/channels/${slug}`,
    `https://kick.com/api/v1/channels/${slug}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) continue;
      const j = (await r.json()) as Record<string, unknown>;
      const live = j.livestream as Record<string, unknown> | undefined;
      if (live && typeof live.is_live === "boolean") return live.is_live;
      if (typeof j.is_live === "boolean") return j.is_live;
      if (j.stream && typeof (j.stream as { is_live?: boolean }).is_live === "boolean") {
        return Boolean((j.stream as { is_live: boolean }).is_live);
      }
    } catch {
      /* try next */
    }
  }
  return false;
}
