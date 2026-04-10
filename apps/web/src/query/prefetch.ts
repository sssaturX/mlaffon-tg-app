import { getToken } from "../api";
import { getStoredActivePlatform } from "../context/PlatformContext";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";
import {
  fetchGiveawaysList,
  fetchHomeContent,
  fetchHomeGiveaways,
  fetchReferrals,
  fetchTasks,
} from "./fetchers";
import { meProfileQueryFn } from "./meQueryFns";

/** Prefetch по намерению навигации (hover по табам). */
export function prefetchRouteData(pathname: string): void {
  if (!getToken()) return;
  const platform = getStoredActivePlatform();

  if (pathname === "/" || pathname === "") {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.home.content(),
      queryFn: fetchHomeContent,
      staleTime: 1000 * 60 * 30,
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.home.giveaways(),
      queryFn: fetchHomeGiveaways,
      staleTime: 1000 * 60 * 2,
    });
    return;
  }

  if (pathname.startsWith("/tasks")) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.tasks.list(platform),
      queryFn: () => fetchTasks(platform),
      staleTime: 1000 * 60 * 5,
    });
    return;
  }

  if (pathname.startsWith("/profile")) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.me.profile(),
      queryFn: meProfileQueryFn,
      staleTime: 1000 * 60 * 5,
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.referrals.list(),
      queryFn: fetchReferrals,
      staleTime: 1000 * 60 * 5,
    });
    return;
  }

  if (pathname.startsWith("/giveaway")) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.giveaways.list(),
      queryFn: fetchGiveawaysList,
      staleTime: 1000 * 60 * 2,
    });
  }
}
