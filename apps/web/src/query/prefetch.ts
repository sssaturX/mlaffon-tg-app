import { getToken } from "../api";
import { getStoredActivePlatform } from "../context/PlatformContext";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";
import {
  fetchFortuneConfig,
  fetchFortuneState,
  fetchGiveawaysList,
  fetchHomeContent,
  fetchHomeGiveaways,
  fetchReferrals,
  fetchTasks,
} from "./fetchers";
import {
  platformQueryParamTasks,
  TASKS_QUERY_STALE_MS,
} from "../hooks/queries/useTasks";
import { meEconomyQueryFn, meProfileQueryFn } from "./meQueryFns";
import {
  fetchShopPage,
  SHOP_GC_TIME_MS,
  SHOP_STALE_TIME_MS,
  type ShopClientPlatform,
} from "./shopQueryFns";

const SHOP_PLATFORMS: ShopClientPlatform[] = ["twitch", "kick"];

function prefetchShopCatalog(): void {
  if (!getToken()) return;
  for (const p of SHOP_PLATFORMS) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.shop.items(p),
      queryFn: () => fetchShopPage(p),
      staleTime: SHOP_STALE_TIME_MS,
      gcTime: SHOP_GC_TIME_MS,
    });
  }
}

/** Hover / touch-down на табах — дедупликация в TanStack Query. */
export function navPrefetchHandlers(pathname: string): {
  onPointerEnter: () => void;
  onPointerDown: () => void;
} {
  const run = (): void => {
    prefetchRouteData(pathname);
  };
  return { onPointerEnter: run, onPointerDown: run };
}

/**
 * Bootstrap prefetch: вызывается один раз после получения токена.
 * Загружает данные главной + tasks параллельно с me/profile + me/economy.
 */
export function prefetchOnBootstrap(): void {
  if (!getToken()) return;
  const platform = getStoredActivePlatform();
  const taskPlatform = platformQueryParamTasks(platform);

  void queryClient.prefetchQuery({
    queryKey: queryKeys.home.content(),
    queryFn: fetchHomeContent,
    staleTime: 1000 * 60 * 30,
  });
  void queryClient.prefetchQuery({
    queryKey: queryKeys.home.giveaways(),
    queryFn: fetchHomeGiveaways,
    staleTime: 1000 * 60 * 5,
  });
  void queryClient.prefetchQuery({
    queryKey: queryKeys.tasks.list(taskPlatform),
    queryFn: () => fetchTasks(taskPlatform),
    staleTime: TASKS_QUERY_STALE_MS,
  });
  void queryClient.prefetchQuery({
    queryKey: queryKeys.fortune.config(),
    queryFn: fetchFortuneConfig,
    staleTime: 1000 * 60 * 60 * 24,
  });
  prefetchShopCatalog();
}

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
      staleTime: 1000 * 60 * 5,
    });
    return;
  }

  if (pathname.startsWith("/tasks")) {
    const taskPlatform = platformQueryParamTasks(platform);
    void queryClient.prefetchQuery({
      queryKey: queryKeys.tasks.list(taskPlatform),
      queryFn: () => fetchTasks(taskPlatform),
      staleTime: TASKS_QUERY_STALE_MS,
    });
    return;
  }

  if (pathname.startsWith("/games")) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.fortune.config(),
      queryFn: fetchFortuneConfig,
      staleTime: 1000 * 60 * 60 * 24,
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.fortune.state(),
      queryFn: fetchFortuneState,
      staleTime: 0,
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
      queryKey: queryKeys.me.economy(),
      queryFn: meEconomyQueryFn,
      staleTime: 1000 * 60 * 10,
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
      staleTime: 1000 * 60 * 5,
    });
    return;
  }

  if (pathname.startsWith("/shop")) {
    prefetchShopCatalog();
  }
}
