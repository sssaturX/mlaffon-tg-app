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
  fetchTasks,
} from "./fetchers";
import {
  platformQueryParamTasks,
  TASKS_QUERY_STALE_MS,
} from "../hooks/queries/useTasks";
import { meSessionQueryFn } from "./meQueryFns";
import {
  fetchShopPage,
  SHOP_GC_TIME_MS,
  SHOP_STALE_TIME_MS,
  type ShopClientPlatform,
} from "./shopQueryFns";

function runWhenIdle(cb: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => cb(), { timeout: 2500 });
  } else {
    window.setTimeout(cb, 250);
  }
}

/** Одна платформа — для приоритетного prefetch и дедупликации с `useQuery`. */
export function prefetchShopPlatform(platform: ShopClientPlatform): void {
  if (!getToken()) return;
  void queryClient.prefetchQuery({
    queryKey: queryKeys.shop.items(platform),
    queryFn: () => fetchShopPage(platform),
    staleTime: SHOP_STALE_TIME_MS,
    gcTime: SHOP_GC_TIME_MS,
  });
}

/**
 * Витрина для обеих платформ: сначала активная из localStorage (меньше конкуренции с другими prefetch),
 * вторая — в idle, чтобы не забивать канал на старте.
 */
export function prefetchShopCatalog(): void {
  if (!getToken()) return;
  const primary = getStoredActivePlatform();
  const secondary: ShopClientPlatform = primary === "kick" ? "twitch" : "kick";
  prefetchShopPlatform(primary);
  runWhenIdle(() => prefetchShopPlatform(secondary));
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
 * После shell: только главная (контент + розыгрыши), без tasks/shop/fortune.
 * В idle — чтобы не конкурировать с первым `GET /me` и первым кадром.
 */
export function prefetchOnBootstrap(): void {
  if (!getToken()) return;
  runWhenIdle(() => {
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
  });
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
      queryKey: queryKeys.me.session(),
      queryFn: meSessionQueryFn,
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
