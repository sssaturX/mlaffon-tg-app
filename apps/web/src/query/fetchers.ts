import type {
  FortuneConfigResponse,
  FortuneStateResponse,
  HomeContentResponse,
  HomeGiveawaysResponse,
  LeaderboardResponse,
  MeEconomyResponse,
  MeProfileResponse,
  ReferralsResponse,
  TaskDto,
} from "shared";
import { api } from "../api";
import { throwIfApiErr } from "./apiQueryError";

/** STATIC / semi-static: сервер отдаёт Cache-Control; клиент не форсирует no-store. */
export async function fetchHomeContent(): Promise<HomeContentResponse> {
  const r = await api<HomeContentResponse>("/api/v1/home/content", {
    httpCache: "default",
  });
  throwIfApiErr(r);
  return r.data;
}

export async function fetchHomeGiveaways(): Promise<HomeGiveawaysResponse> {
  const r = await api<HomeGiveawaysResponse>("/api/v1/home/giveaways", {
    httpCache: "default",
  });
  throwIfApiErr(r);
  return r.data;
}

export async function fetchMeProfile(): Promise<MeProfileResponse> {
  const r = await api<MeProfileResponse>("/api/v1/me/profile", {
    httpCache: "default",
  });
  throwIfApiErr(r);
  return r.data;
}

/** Обход HTTP-кэша: для polling после OAuth, где нужен гарантированно свежий ответ. */
export async function fetchMeProfileNoCache(): Promise<MeProfileResponse> {
  const r = await api<MeProfileResponse>("/api/v1/me/profile", {
    httpCache: "no-store",
  });
  throwIfApiErr(r);
  return r.data;
}

/** Баланс / уровень / стрики; инкременты — по WS `me_update`, reconcile — этот GET. */
export async function fetchMeEconomy(): Promise<MeEconomyResponse> {
  const r = await api<MeEconomyResponse>("/api/v1/me/economy");
  throwIfApiErr(r);
  return r.data;
}

export async function fetchTasks(platform: string): Promise<TaskDto[]> {
  const r = await api<{ tasks: TaskDto[] }>(
    `/api/v1/tasks?platform=${encodeURIComponent(platform)}`,
    { httpCache: "no-store" }
  );
  throwIfApiErr(r);
  return r.data.tasks;
}

export async function fetchFortuneConfig(): Promise<FortuneConfigResponse> {
  const r = await api<FortuneConfigResponse>(
    "/api/v1/games/fortune/config",
    { httpCache: "default" }
  );
  throwIfApiErr(r);
  return r.data;
}

export async function fetchFortuneState(): Promise<FortuneStateResponse> {
  const r = await api<FortuneStateResponse>("/api/v1/games/fortune/state");
  throwIfApiErr(r);
  return r.data;
}

export async function fetchReferrals(): Promise<ReferralsResponse> {
  const r = await api<ReferralsResponse>("/api/v1/referrals", {
    httpCache: "default",
  });
  throwIfApiErr(r);
  return r.data;
}

export type GiveawayListItemDto = {
  id: string;
  title: string;
  prizeText: string;
  imageUrl: string | null;
  endsAt: string;
  platform: "twitch" | "kick" | "both";
  winnerCount: number;
  ticketPriceCoins: number;
  participantCount: number;
  drawnAt: string | null;
  active: boolean;
  status: "live" | "ended_awaiting_draw" | "completed";
};

export async function fetchGiveawaysList(): Promise<GiveawayListItemDto[]> {
  const r = await api<{ giveaways: GiveawayListItemDto[] }>(
    "/api/v1/giveaways",
    { httpCache: "default" }
  );
  throwIfApiErr(r);
  return r.data.giveaways;
}

export type GiveawayDetailDto = {
  id: string;
  title: string;
  prizeText: string;
  description: string | null;
  imageUrl: string | null;
  endsAt: string;
  platform: "twitch" | "kick" | "both";
  active: boolean;
  winnerCount: number;
  ticketPriceCoins: number;
  participantCount: number;
  drawnAt: string | null;
  winners: { rank: number; username: string }[];
  isParticipant: boolean;
  joinedAt: string | null;
  requireChannelSubscription: boolean;
  channelInviteUrl: string | null;
  channelSubscriptionOk: boolean | null;
};

export async function fetchGiveawayDetail(id: string): Promise<GiveawayDetailDto> {
  const r = await api<GiveawayDetailDto>(`/api/v1/giveaways/${id}`, {
    httpCache: "default",
  });
  throwIfApiErr(r);
  return r.data;
}

export async function fetchLeaderboard(
  sort: "coins" | "streak" | "referrals",
  platform: "all" | "twitch" | "kick"
): Promise<LeaderboardResponse> {
  const q = new URLSearchParams({ sort, platform });
  const r = await api<LeaderboardResponse>(
    `/api/v1/leaderboard?${q.toString()}`,
    { httpCache: "default" }
  );
  throwIfApiErr(r);
  return r.data;
}
