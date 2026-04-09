import { useQuery } from "@tanstack/react-query";
import { getToken } from "../../api";
import { fetchLeaderboard } from "../../query/fetchers";
import { queryKeys } from "../../query/queryKeys";

const STALE_LEADERBOARD = 1000 * 60 * 2;

export function useLeaderboard(
  sort: "coins" | "streak" | "referrals",
  platform: "all" | "twitch" | "kick"
) {
  return useQuery({
    queryKey: queryKeys.leaderboard.entry(sort, platform),
    queryFn: () => fetchLeaderboard(sort, platform),
    enabled: Boolean(getToken()),
    staleTime: STALE_LEADERBOARD,
  });
}
