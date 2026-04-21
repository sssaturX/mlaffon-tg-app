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
  FORTUNE_STATE_STALE_MS,
} from "../hooks/queries/useFortuneQueries";
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
import { markUserNavActivation } from "../perf/routeTransitionPerf";

function runWhenIdle(cb: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => cb(), { timeout: 2500 });
  } else {
    window.setTimeout(cb, 250);
  }
}

/**
 * Один жест навигации даёт pointerdown + click (и иногда touchstart + click).
 * Два вызова `prefetchRouteData` подряд с `staleTime: 0` (раньше — fortune state)
 * или просто двойной конкурирующий prefetch не нужны — TanStack не дедуплицирует
 * второй старт, если первый уже завершился и данные снова «stale».
 */
const PREFETCH_ROUTE_DATA_DEDUPE_MS = 450;
let lastRouteDataPrefetchPath: string | null = null;
let lastRouteDataPrefetchAt = 0;

function shouldSkipRapidPrefetchRouteData(pathname: string): boolean {
  const p = (pathname.split("?")[0] || "").trim() || "/";
  const now = Date.now();
  if (
    lastRouteDataPrefetchPath === p &&
    now - lastRouteDataPrefetchAt < PREFETCH_ROUTE_DATA_DEDUPE_MS
  ) {
    return true;
  }
  lastRouteDataPrefetchPath = p;
  lastRouteDataPrefetchAt = now;
  return false;
}

/**
 * Прогрев JS chunk для lazy-страниц (см. `App.tsx` lazy()).
 * Уменьшает gap между кликом по табу и стартом `useQuery`: иначе сначала грузится chunk,
 * потом монтируется страница (анимация см. `RouteTransition` — `popLayout`).
 * Вызывать только из nav intent (hover / pointerdown), не из global bootstrap.
 */
export function prefetchRoutePageChunk(pathname: string): void {
  const p = pathname.split("?")[0] || "";
  if (p === "/tasks" || p.startsWith("/tasks/")) {
    void import("../pages/Tasks");
    return;
  }
  if (p === "/games" || p.startsWith("/games/")) {
    void import("../pages/Games");
    return;
  }
  if (p === "/shop" || p.startsWith("/shop/")) {
    void import("../pages/Shop");
    return;
  }
  if (p === "/profile" || p.startsWith("/profile/")) {
    void import("../pages/Profile");
    return;
  }
  if (p.startsWith("/giveaway/")) {
    void import("../pages/Giveaway");
    return;
  }
  if (p === "/giveaways") {
    void import("../pages/Giveaways");
    return;
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
 * Только активная платформа из localStorage (совпадает с `useActivePlatform` до эфира).
 * Вторая платформа не префетчится: экран Shop и так сделает один `useQuery` при переключении
 * тумблера — иначе каждый hover/клик по «Магазин» билит и Twitch, и Kick без UX-причины.
 */
export function prefetchShopCatalog(): void {
  if (!getToken()) return;
  prefetchShopPlatform(getStoredActivePlatform());
}

function prefetchHoverIntent(pathname: string): void {
  prefetchRoutePageChunk(pathname);
  prefetchRouteData(pathname);
}

/** pointerdown/touchstart/click: chunk + data + DEV measure (TanStack Query дедуплицирует повторы). */
function prefetchActivationIntent(pathname: string): void {
  prefetchHoverIntent(pathname);
  markUserNavActivation(pathname);
}

/**
 * Табы навигации и аналогичные ссылки:
 * - pointerenter — только prefetch (hover desktop), без perf-mark;
 * - pointerdown / touchstart / click — prefetch + mark (mobile tap, мышь, Enter по фокусу).
 */
export function navPrefetchHandlers(pathname: string): {
  onPointerEnter: () => void;
  onPointerDown: () => void;
  onTouchStart: () => void;
  onClick: () => void;
} {
  return {
    onPointerEnter: () => prefetchHoverIntent(pathname),
    onPointerDown: () => prefetchActivationIntent(pathname),
    onTouchStart: () => prefetchActivationIntent(pathname),
    onClick: () => prefetchActivationIntent(pathname),
  };
}

/** То же поведение, что `navPrefetchHandlers`, для `<Link>` (розыгрыши и т.д.). */
export const linkPrefetchHandlers = navPrefetchHandlers;

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
  if (shouldSkipRapidPrefetchRouteData(pathname)) {
    return;
  }
  const platform = getStoredActivePlatform();

  /** Публичный GET /api/v1/games/fortune/config — не требует JWT. */
  if (pathname.startsWith("/games")) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.fortune.config(),
      queryFn: fetchFortuneConfig,
      staleTime: 1000 * 60 * 60 * 24,
    });
    if (getToken()) {
      void queryClient.prefetchQuery({
        queryKey: queryKeys.fortune.state(),
        queryFn: fetchFortuneState,
        staleTime: FORTUNE_STATE_STALE_MS,
      });
    }
    return;
  }

  if (!getToken()) return;

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
