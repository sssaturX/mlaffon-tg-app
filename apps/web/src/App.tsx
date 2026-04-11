import { useQuery } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getPlatformTheme } from "./platformTheme";
import { useActivePlatform } from "./context/PlatformContext";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import WebApp from "@twa-dev/sdk";
import type { MeResponse } from "shared";
import {
  Home,
  ListTodo,
  Gamepad2,
  ShoppingBag,
  User,
} from "lucide-react";
import {
  authDev,
  authTelegramWithRetry,
  formatApiError,
  getToken,
  setToken,
} from "./api";
import { useToast } from "./context/ToastContext";
import { OnboardingModal, hasSeenOnboarding } from "./components/OnboardingModal";
import { FirstVisitTour, hasSeenTour } from "./components/FirstVisitTour";
import { routeTitle, ScreenHeader } from "./components/ScreenHeader";
import { AppLoadingSpinner } from "./components/AppLoadingSpinner";
import { RouteTransition } from "./components/RouteTransition";
import { hasLinkedStreamingAccount } from "./utils/streamingAccount";
import { MeEconomySyncProvider } from "./context/MeEconomySyncContext";
import { useSyncMeFromNetwork } from "./hooks/useSyncMeFromNetwork";
import { useMergedMe } from "./hooks/queries/useMergedMe";
import {
  handleMeUpdateFromWs,
  invalidateInflightMeRefresh,
} from "./services/meService";
import { navPrefetchHandlers, prefetchOnBootstrap } from "./query/prefetch";
import { meEconomyQueryFn, meProfileQueryFn, meProfileQueryFnNoCache } from "./query/meQueryFns";
import { appEventBus } from "./events/appEventBus";
import { emitAppBootstrap } from "./meDomain/bootstrapOrchestrator";
import { queryClient } from "./query/queryClient";
import { queryKeys } from "./query/queryKeys";
import { DropOverlay, type DropSnapshot } from "./components/DropOverlay";
import { DropTicker } from "./components/DropTicker";
import { useSyncedCountdownMs } from "./hooks/useSyncedCountdown";
import { useRealtimeWebSocket, type DropStartedPayload } from "./hooks/useRealtimeWebSocket";
import { applyWsInitialState } from "./realtime/applyWsInitialState";
import { useDocumentVisible } from "./hooks/useDocumentVisible";
import {
  applyDropClaimedToQuery,
  applyDropFinishedToQuery,
  applyDropStartedToQuery,
  applyGiveawaysSnapshotToQueries,
  applyLiveEndedToQuery,
  applyLiveStartedToQuery,
  applyPredictionStateToQuery,
} from "./realtime/realtimeQueryUpdaters";
import {
  dropsActiveWsOnlyQueryFn,
  liveBroadcastWsOnlyQueryFn,
} from "./realtime/wsOnlyQueryFns";
import {
  getStartParamFromInitData,
  looksLikeTelegramMiniApp,
  waitForTelegramInitData,
} from "./utils/waitForTelegramInitData";
import { WebLogin } from "./pages/WebLogin";

const HomePage = lazy(() => import("./pages/Home"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Games = lazy(() => import("./pages/Games"));
const Shop = lazy(() => import("./pages/Shop"));
// Лидерборд скрыт: при возврате — lazy("./pages/Leaderboard"), Route + NavLink «Топ», см. GET /api/v1/leaderboard.
const Profile = lazy(() => import("./pages/Profile"));
const OAuthReturn = lazy(() => import("./pages/OAuthReturn"));
const OAuthBrowserDone = lazy(() => import("./pages/OAuthBrowserDone"));
const GiveawayPage = lazy(() => import("./pages/Giveaway"));
const GiveawaysPage = lazy(() => import("./pages/Giveaways"));
const BannedScreen = lazy(() => import("./pages/BannedScreen"));
const WelcomeGate = lazy(() => import("./pages/WelcomeGate"));

const devAuth =
  import.meta.env.VITE_ALLOW_DEV === "1" || import.meta.env.DEV;

export default function App() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const [ready, setReady] = useState(false);
  const [webLogin, setWebLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { me, isInitialLoading, profileQ, economyQ } = useMergedMe();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const syncMeFromNetwork = useSyncMeFromNetwork();

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    try {
      const wa = WebApp as {
        isFullscreen?: boolean;
        exitFullscreen?: () => void;
        disableVerticalSwipes?: () => void;
      };
      if (wa.isFullscreen === true && typeof wa.exitFullscreen === "function") {
        wa.exitFullscreen();
      }
      wa.disableVerticalSwipes?.();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);

      /** Дать WebView один кадр после WebApp.ready() — initData иногда появляется не синхронно. */
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      let initData = WebApp.initData?.trim() ?? "";
      if (!initData && looksLikeTelegramMiniApp()) {
        initData = (await waitForTelegramInitData(5500)) ?? "";
      }

      const startParam = initData ? getStartParamFromInitData(initData) : null;
      /** Иначе старый JWT из localStorage перехватывает запуск и startapp=link_* не доходит до API. */
      const isTelegramAccountLink = startParam?.startsWith("link_") === true;
      const isOAuthReturn = startParam === "oauth_ok";

      const existing = getToken();

      /**
       * Важно: при наличии initData сначала обмен на JWT (мини-приложение).
       * Иначе старый веб-токен в localStorage даёт ранний prefetch → 401 / ошибка профиля,
       * а «Повторить» очищает сессию (hydrateMeThroughEventBus при auth_error).
       */
      if (initData) {
        const r = await authTelegramWithRetry(initData);
        if (cancelled) return;
        if (r.ok) {
          setToken(r.data.token);
          queryClient.removeQueries({ queryKey: queryKeys.me.profile() });
          queryClient.removeQueries({ queryKey: queryKeys.me.economy() });
          const profileFn = isOAuthReturn ? meProfileQueryFnNoCache : meProfileQueryFn;
          void Promise.all([
            queryClient.prefetchQuery({
              queryKey: queryKeys.me.profile(),
              queryFn: profileFn,
            }),
            queryClient.prefetchQuery({
              queryKey: queryKeys.me.economy(),
              queryFn: meEconomyQueryFn,
            }),
          ]);
          if (!isOAuthReturn) prefetchOnBootstrap();
          if (r.data.accountsMerged === true) {
            showToast(
              "Аккаунты объединены. Оставлен профиль с большим прогрессом.",
              "success",
              { durationMs: 5200 }
            );
          }
        } else {
          const m = formatApiError(r);
          setError(m);
          showToast(m, "error");
        }
        setReady(true);
        return;
      }

      if (existing && !isTelegramAccountLink) {
        void Promise.all([
          queryClient.prefetchQuery({
            queryKey: queryKeys.me.profile(),
            queryFn: meProfileQueryFn,
          }),
          queryClient.prefetchQuery({
            queryKey: queryKeys.me.economy(),
            queryFn: meEconomyQueryFn,
          }),
        ]);
        if (cancelled) return;
        setReady(true);
        return;
      }

      if (devAuth) {
        const r = await authDev(1000001, "local_dev");
        if (cancelled) return;
        if (r.ok) {
          setToken(r.data.token);
          void Promise.all([
            queryClient.prefetchQuery({
              queryKey: queryKeys.me.profile(),
              queryFn: meProfileQueryFn,
            }),
            queryClient.prefetchQuery({
              queryKey: queryKeys.me.economy(),
              queryFn: meEconomyQueryFn,
            }),
          ]);
        } else {
          const m = formatApiError(r);
          setError(m);
          showToast(m, "error");
        }
        setReady(true);
        return;
      }

      if (looksLikeTelegramMiniApp()) {
        const m =
          "Не удалось получить данные Telegram. Откройте мини-приложение из бота.";
        setError(m);
        showToast(m, "error");
        setReady(true);
        return;
      }

      if (import.meta.env.VITE_ALLOW_WEB_AUTH !== "0") {
        setWebLogin(true);
        return;
      }

      const m = "Откройте приложение внутри Telegram";
      setError(m);
      showToast(m, "error");
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    if (!ready || !getToken() || !me) return;
    if (!hasLinkedStreamingAccount(me)) return;
    if (!hasSeenOnboarding()) setOnboardingOpen(true);
  }, [ready, me]);

  useEffect(() => {
    if (ready && getToken()) emitAppBootstrap("token_ready");
  }, [ready]);

  if (webLogin) {
    return (
      <WebLogin
        onLoggedIn={() => {
          void Promise.all([
            queryClient.prefetchQuery({
              queryKey: queryKeys.me.profile(),
              queryFn: meProfileQueryFn,
            }),
            queryClient.prefetchQuery({
              queryKey: queryKeys.me.economy(),
              queryFn: meEconomyQueryFn,
            }),
          ]);
          setWebLogin(false);
          setReady(true);
        }}
      />
    );
  }

  if (!ready) {
    return <AppLoadingSpinner />;
  }

  const oauthPathOk = /^\/oauth\/(twitch|kick)\/?$/.test(location.pathname);
  const oauthHasResult =
    searchParams.get("connected") === "1" ||
    Boolean(searchParams.get("error")?.length);
  const oauthRcTma = searchParams.get("rc") === "tma";
  /**
   * Показываем OAuthBrowserDone если:
   * - rc=tma (всегда — этот браузер не TMA WebView, любой JWT тут бесполезен)
   * - или нет JWT и есть OAuth результат (веб-flow, но токен потерян)
   */
  const showOAuthDonePage =
    oauthPathOk && oauthHasResult && (oauthRcTma || !getToken());

  if (showOAuthDonePage) {
    return (
      <Suspense fallback={<AppLoadingSpinner />}>
        <OAuthBrowserDone />
      </Suspense>
    );
  }

  if (error || !getToken()) {
    return (
      <div className="app-shell">
        <div className="app-main">
          <div className="card stack">
            <h1>Вход</h1>
            {error && <p className="err">{error}</p>}
            <p className="muted">
              {import.meta.env.DEV ? (
                <>
                  Откройте приложение из бота Telegram или войдите на сайте. Для
                  теста без Telegram в API можно включить режим разработчика и
                  снова открыть эту страницу.
                </>
              ) : (
                <>
                  Откройте мини-приложение из чата с ботом в Telegram или войдите
                  на сайте — если вход с сайта для вас включён.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isInitialLoading) {
    return <AppLoadingSpinner />;
  }

  if (profileQ.isError || economyQ.isError) {
    return (
      <div className="app-shell">
        <div className="app-main">
          <div className="card stack">
            <h1>Профиль</h1>
            <p className="err">
              Не удалось загрузить данные. Проверьте сеть и попробуйте снова.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => void syncMeFromNetwork()}
            >
              Повторить
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (me?.banned) {
    const displayName =
      me.firstName?.trim() ||
      (me.username ? `@${me.username}` : "") ||
      "Игрок";
    return (
      <Suspense fallback={<AppLoadingSpinner />}>
        <BannedScreen
          displayName={displayName}
          banReason={me.banReason}
          appealPending={me.banAppealPending}
          onRefresh={syncMeFromNetwork}
        />
      </Suspense>
    );
  }

  if (!me) {
    return <AppLoadingSpinner />;
  }

  return (
    <MeEconomySyncProvider>
      <AppShell
        me={me}
        needsPlatformLink={!hasLinkedStreamingAccount(me)}
        online={online}
        onboardingOpen={onboardingOpen}
        onCloseOnboarding={() => setOnboardingOpen(false)}
        onShowOnboarding={() => setOnboardingOpen(true)}
      />
    </MeEconomySyncProvider>
  );
}

const botFooter =
  import.meta.env.VITE_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";

function AppShell({
  me,
  needsPlatformLink,
  online,
  onboardingOpen,
  onCloseOnboarding,
  onShowOnboarding,
}: {
  me: MeResponse;
  /** Полноэкранный экран привязки Kick/Twitch до первого OAuth. */
  needsPlatformLink: boolean;
  online: boolean;
  onboardingOpen: boolean;
  onCloseOnboarding: () => void;
  onShowOnboarding: () => void;
}) {
  const syncMeFromNetwork = useSyncMeFromNetwork();
  const location = useLocation();
  const { activePlatform, setActivePlatform } = useActivePlatform();

  const { data: liveForPlatform } = useQuery({
    queryKey: queryKeys.liveBroadcast.current(),
    queryFn: liveBroadcastWsOnlyQueryFn,
    staleTime: Infinity,
    enabled: false,
  });

  /** Пока идёт эфир — шапка и баланс строго по платформе стрима; без эфира переключатель свободен. */
  useEffect(() => {
    if (liveForPlatform?.active === true) {
      setActivePlatform(liveForPlatform.platform);
    }
  }, [liveForPlatform, setActivePlatform]);

  const bootstrapDoneRef = useRef(false);
  useEffect(() => {
    if (needsPlatformLink || bootstrapDoneRef.current) return;
    bootstrapDoneRef.current = true;
    prefetchOnBootstrap();
  }, [needsPlatformLink]);

  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const [dropOpen, setDropOpen] = useState(false);
  const docVisible = useDocumentVisible();
  /** Была скрыта вкладка — при возврате делаем один sync без ожидания таймера. */
  const tabWasHiddenRef = useRef(false);

  useEffect(() => {
    if (!me || onboardingOpen || needsPlatformLink) return;
    if (!hasSeenTour()) setTourOpen(true);
  }, [me, onboardingOpen, needsPlatformLink]);

  useEffect(() => {
    if (tourOpen) setTourStep(0);
  }, [tourOpen]);

  const realtimeConnected = useRealtimeWebSocket(
    {
      onMePatch: (patch) => {
        handleMeUpdateFromWs(patch);
      },
      onDropStarted: (data: DropStartedPayload) => {
        applyDropStartedToQuery(data);
      },
      onDropFinished: (dropId) => {
        applyDropFinishedToQuery(dropId);
        setDropOpen(false);
      },
      onDropClaimed: ({ dropId, reward }) => {
        applyDropClaimedToQuery(dropId, reward);
      },
      onLiveStarted: (data) => {
        applyLiveStartedToQuery(data);
      },
      onLiveEnded: () => {
        applyLiveEndedToQuery();
      },
      onPredictionState: (data) => {
        applyPredictionStateToQuery(data);
      },
      onGiveawaysUpdated: (data) => {
        applyGiveawaysSnapshotToQueries(data);
      },
      /** Не делаем HTTP refetch на каждый reconnect — придёт `initial_state` / инкрементальные события. */
      onOpen: () => {
        invalidateInflightMeRefresh();
      },
      onInitialState: (data) => {
        applyWsInitialState(data);
      },
      onLegacyBalancePing: () => {
        invalidateInflightMeRefresh();
      },
    },
    /** WS нужен и до привязки стрима: `me_update` и `initial_state` без лишнего REST. Сервер не требует OAuth-платформы. */
    !!me
  );

  const { data: dropSnap } = useQuery({
    queryKey: queryKeys.drops.active(),
    queryFn: dropsActiveWsOnlyQueryFn,
    staleTime: Infinity,
    enabled: false,
  });

  useEffect(() => {
    if (needsPlatformLink) return;
    if (!docVisible) {
      tabWasHiddenRef.current = true;
      return;
    }
    if (tabWasHiddenRef.current) {
      tabWasHiddenRef.current = false;
      if (!realtimeConnected) {
        appEventBus.emit("me:reconcile:economy", { delayMs: 0 });
      }
    }
  }, [docVisible, needsPlatformLink, realtimeConnected]);

  /** Без WS — редкая ревалидация только экономики (не весь профиль). */
  useEffect(() => {
    if (!me?.id || needsPlatformLink) return;
    if (realtimeConnected) return;
    if (!docVisible) return;
    const id = window.setInterval(
      () => appEventBus.emit("me:reconcile:economy", { delayMs: 0 }),
      90_000
    );
    return () => clearInterval(id);
  }, [me?.id, needsPlatformLink, realtimeConnected, docVisible]);

  const headerBalance =
    me == null
      ? null
      : activePlatform === "twitch"
        ? me.coinsTwitch
        : me.coinsKick;

  useEffect(() => {
    const theme = getPlatformTheme(activePlatform);
    document.documentElement.setAttribute("data-platform-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-platform-theme");
    };
  }, [activePlatform]);

  const autoOpenedDropRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dropSnap || !dropSnap.hasActiveDrop || dropSnap.won) return;
    if (autoOpenedDropRef.current === dropSnap.dropId) return;
    autoOpenedDropRef.current = dropSnap.dropId;
    try {
      const k = `mlaffon_drop_auto_${dropSnap.dropId}`;
      if (!sessionStorage.getItem(k)) {
        sessionStorage.setItem(k, "1");
        setDropOpen(true);
      }
    } catch {
      setDropOpen(true);
    }
  }, [dropSnap]);

  const openDrop = useCallback(() => {
    setDropOpen(true);
  }, []);

  const dropTickerActive =
    Boolean(me) &&
    dropSnap?.hasActiveDrop === true &&
    !dropSnap.won;

  /** Одно смещение на дроп: из кэша (WS) или закрепление при первом появлении снимка. */
  const dropClockOffsetMs = useMemo(() => {
    const d =
      dropSnap?.hasActiveDrop === true ? dropSnap : null;
    if (!d) return null;
    if (
      typeof d.countdownOffsetMs === "number" &&
      Number.isFinite(d.countdownOffsetMs)
    ) {
      return d.countdownOffsetMs;
    }
    if (d.serverNow) {
      return Date.parse(d.serverNow) - Date.now();
    }
    return (
      Date.parse(d.endsAt) -
      d.remainingSeconds * 1000 -
      Date.now()
    );
  }, [
    dropSnap?.hasActiveDrop === true ? dropSnap.dropId : null,
    dropSnap?.hasActiveDrop === true ? dropSnap.countdownOffsetMs : null,
    dropSnap?.hasActiveDrop === true ? dropSnap.serverNow : null,
    dropSnap?.hasActiveDrop === true ? dropSnap.endsAt : null,
    dropSnap?.hasActiveDrop === true ? dropSnap.remainingSeconds : null,
  ]);

  const dropRemainingMs = useSyncedCountdownMs(
    dropSnap?.hasActiveDrop ? dropSnap.endsAt : null,
    dropClockOffsetMs,
    dropTickerActive
  );

  const dropSecondsLeft = Math.max(0, Math.floor(dropRemainingMs / 1000));

  const showDropTicker =
    Boolean(me) &&
    dropSnap?.hasActiveDrop === true &&
    !dropSnap.won;

  /** Пока идёт редирект OAuth — показываем полноэкранный спиннер, не welcome поверх. */
  const oauthInProgress = /^\/oauth\/(twitch|kick)/.test(location.pathname);
  const showWelcomeOverlay = needsPlatformLink && !oauthInProgress;

  return (
    <>
      {!online && !needsPlatformLink ? (
        <div className="offline-banner" role="status">
          Нет сети — проверьте подключение
        </div>
      ) : null}

      {showDropTicker ? (
        <DropTicker secondsLeft={dropSecondsLeft} onOpen={openDrop} />
      ) : null}

      {!needsPlatformLink ? (
        <OnboardingModal open={onboardingOpen} onClose={onCloseOnboarding} />
      ) : null}

      {!needsPlatformLink ? (
        <FirstVisitTour
          open={tourOpen}
          step={tourStep}
          onStepChange={setTourStep}
          onClose={() => setTourOpen(false)}
        />
      ) : null}

      <div className="app-shell">
        {!needsPlatformLink ? (
          <ScreenHeader
            title={routeTitle(location.pathname)}
            balance={headerBalance ?? 0}
          />
        ) : null}

        <main className="app-main">
          <RouteTransition routeKey={location.pathname}>
            <Suspense fallback={<AppLoadingSpinner />}>
              <Routes>
              <Route
                path="/"
                element={<HomePage me={me} />}
              />
              <Route path="/giveaways" element={<GiveawaysPage me={me} />} />
              <Route
                path="/giveaway/:id"
                element={<GiveawayPage me={me} />}
              />
              <Route path="/tasks" element={<Tasks />} />
              <Route
                path="/games"
                element={<Games />}
              />
              <Route
                path="/shop"
                element={<Shop />}
              />
              <Route
                path="/oauth/:platform"
                element={<OAuthReturn />}
              />
              <Route
                path="/profile"
                element={
                  <Profile
                    me={me}
                    onShowOnboarding={onShowOnboarding}
                  />
                }
              />
              <Route path="/stream" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </RouteTransition>
        </main>

        {!needsPlatformLink ? (
        <div className="nav-wrap">
          <nav className="nav" aria-label="Основное меню">
            <NavLink
              end
              className={({ isActive }) => (isActive ? "active" : "")}
              to="/"
              {...navPrefetchHandlers("/")}
            >
              <Home className="nav__icon" aria-hidden />
              <span>Главная</span>
            </NavLink>
            <NavLink
              data-tour-target="nav-tasks"
              className={({ isActive }) => (isActive ? "active" : "")}
              to="/tasks"
              {...navPrefetchHandlers("/tasks")}
            >
              <ListTodo className="nav__icon" aria-hidden />
              <span>Задания</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? "active" : "")}
              to="/games"
              {...navPrefetchHandlers("/games")}
            >
              <Gamepad2 className="nav__icon" aria-hidden />
              <span>Игры</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? "active" : "")}
              to="/shop"
            >
              <ShoppingBag className="nav__icon" aria-hidden />
              <span>Магазин</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? "active" : "")}
              to="/profile"
              {...navPrefetchHandlers("/profile")}
            >
              <User className="nav__icon" aria-hidden />
              <span>Профиль</span>
            </NavLink>
          </nav>
          {botFooter ? (
            <div className="nav-footer">@{botFooter}</div>
          ) : null}
        </div>
        ) : null}
      </div>

      {showWelcomeOverlay && me ? (
        <div className="welcome-gate-overlay">
          <Suspense fallback={<AppLoadingSpinner />}>
            <WelcomeGate me={me} />
          </Suspense>
        </div>
      ) : null}

      {me ? (
        <DropOverlay
          open={dropOpen}
          onClose={() => setDropOpen(false)}
          snapshot={dropSnap ?? null}
          clockOffsetMs={dropClockOffsetMs}
          onAfterClaim={(reward) => {
            const snap = queryClient.getQueryData<DropSnapshot>(
              queryKeys.drops.active()
            );
            if (snap?.hasActiveDrop && snap.dropId) {
              applyDropClaimedToQuery(snap.dropId, reward);
            }
          }}
          onRefreshSnapshot={() => {
            queryClient.setQueryData(queryKeys.drops.active(), (prev: DropSnapshot | undefined) =>
              prev ? { ...prev } : prev
            );
          }}
        />
      ) : null}
    </>
  );
}
