import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import {
  Home,
  ListTodo,
  Gamepad2,
  ShoppingBag,
  User,
} from "lucide-react";
import {
  api,
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
import { hasLinkedStreamingAccount } from "./utils/streamingAccount";
import { MeEconomySyncProvider } from "./context/MeEconomySyncContext";
import { useMeStore } from "./store/meStore";
import { useMeRefresh } from "./hooks/useMeRefresh";
import { handleMeUpdateFromWs, refreshMe as refreshMeFromService } from "./services/meService";
import { DropOverlay, type DropSnapshot } from "./components/DropOverlay";
import { DropTicker } from "./components/DropTicker";
import { useSyncedCountdownMs } from "./hooks/useSyncedCountdown";
import { useRealtimeWebSocket, type DropStartedPayload } from "./hooks/useRealtimeWebSocket";
import { useDocumentVisible } from "./hooks/useDocumentVisible";
import { useLiveBroadcastStore } from "./store/liveBroadcastStore";
import { usePredictionStore } from "./store/predictionStore";
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
  const me = useMeStore((s) => s.me);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const refreshMe = useMeRefresh();

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

      let initData = WebApp.initData?.trim() ?? "";
      if (!initData && looksLikeTelegramMiniApp()) {
        initData = (await waitForTelegramInitData(2000)) ?? "";
      }

      const startParam = initData ? getStartParamFromInitData(initData) : null;
      /** Иначе старый JWT из localStorage перехватывает запуск и startapp=link_* не доходит до API. */
      const isTelegramAccountLink = startParam?.startsWith("link_") === true;

      const existing = getToken();
      if (existing && !isTelegramAccountLink) {
        await refreshMe();
        if (cancelled) return;
        setReady(true);
        return;
      }

      if (initData) {
        const r = await authTelegramWithRetry(initData);
        if (cancelled) return;
        if (r.ok) {
          setToken(r.data.token);
          await refreshMe();
          if (r.data.accountsMerged === true) {
            showToast(
              "Аккаунты объединены. Оставлен профиль с большим прогрессом.",
              "success",
              { durationMs: 5200 }
            );
          }
        } else {
          setError(formatApiError(r));
        }
        setReady(true);
        return;
      }

      if (devAuth) {
        const r = await authDev(1000001, "local_dev");
        if (cancelled) return;
        if (r.ok) {
          setToken(r.data.token);
          await refreshMe();
        } else {
          setError(formatApiError(r));
        }
        setReady(true);
        return;
      }

      if (looksLikeTelegramMiniApp()) {
        setError(
          "Не удалось получить данные Telegram. Откройте мини-приложение из бота."
        );
        setReady(true);
        return;
      }

      if (import.meta.env.VITE_ALLOW_WEB_AUTH !== "0") {
        setWebLogin(true);
        return;
      }

      setError("Откройте приложение внутри Telegram");
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe, showToast]);

  useEffect(() => {
    if (!ready || !getToken() || !me) return;
    if (!hasLinkedStreamingAccount(me)) return;
    if (!hasSeenOnboarding()) setOnboardingOpen(true);
  }, [ready, me]);

  if (webLogin) {
    return (
      <WebLogin
        onLoggedIn={async () => {
          await refreshMe();
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
  const oauthExternalNoToken =
    oauthPathOk && oauthHasResult && !getToken();

  if (oauthExternalNoToken) {
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
          onRefresh={refreshMe}
        />
      </Suspense>
    );
  }

  if (!me) {
    return <AppLoadingSpinner />;
  }

  return (
    <AppShell
      needsPlatformLink={!hasLinkedStreamingAccount(me)}
      online={online}
      onboardingOpen={onboardingOpen}
      onCloseOnboarding={() => setOnboardingOpen(false)}
      onShowOnboarding={() => setOnboardingOpen(true)}
    />
  );
}

const botFooter =
  import.meta.env.VITE_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";

function AppShell({
  needsPlatformLink,
  online,
  onboardingOpen,
  onCloseOnboarding,
  onShowOnboarding,
}: {
  /** Полноэкранный экран привязки Kick/Twitch до первого OAuth. */
  needsPlatformLink: boolean;
  online: boolean;
  onboardingOpen: boolean;
  onCloseOnboarding: () => void;
  onShowOnboarding: () => void;
}) {
  const me = useMeStore((s) => s.me);
  const refreshMe = useMeRefresh();
  const location = useLocation();
  const { activePlatform, setActivePlatform } = useActivePlatform();
  const liveBroadcast = useLiveBroadcastStore((s) => s.broadcast);

  /** Пока идёт эфир — шапка и баланс строго по платформе стрима; без эфира переключатель свободен. */
  useEffect(() => {
    if (liveBroadcast?.active === true) {
      setActivePlatform(liveBroadcast.platform);
    }
  }, [liveBroadcast, setActivePlatform]);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const [dropSnap, setDropSnap] = useState<DropSnapshot | null>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const docVisible = useDocumentVisible();
  /** Была скрыта вкладка — при возврате делаем один sync без ожидания таймера. */
  const tabWasHiddenRef = useRef(false);

  const loadDropInflight = useRef<Promise<void> | null>(null);
  const loadDrop = useCallback(async () => {
    if (!getToken()) {
      setDropSnap(null);
      return;
    }
    if (loadDropInflight.current) return loadDropInflight.current;
    const p = (async () => {
      const r = await api<DropSnapshot>("/api/v1/drops/active");
      if (r.ok) setDropSnap(r.data);
    })();
    loadDropInflight.current = p;
    try { await p; } finally { loadDropInflight.current = null; }
  }, []);

  /** Один HTTP catch-up для дропа + эфира + предикта; без дублей mount + WS onOpen за одну сессию. */
  const lastRealtimeHttpSyncMsRef = useRef(0);
  const syncRealtimeFromHttp = useCallback(
    (opts?: { force?: boolean }) => {
      if (!getToken()) return;
      const now = Date.now();
      const minMs = 2500;
      if (!opts?.force && now - lastRealtimeHttpSyncMsRef.current < minMs) return;
      lastRealtimeHttpSyncMsRef.current = now;
      void loadDrop();
      void useLiveBroadcastStore.getState().hydrateFromApi();
      void usePredictionStore.getState().hydrateFromApi();
    },
    [loadDrop]
  );

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
        const snap: DropSnapshot = {
          hasActiveDrop: true,
          dropId: data.dropId,
          endsAt: data.endsAt,
          serverNow: data.serverNow,
          remainingSeconds: data.remainingSeconds,
          platform: (data.platform === "twitch" || data.platform === "kick" || data.platform === "both")
            ? data.platform
            : undefined,
          maxWinners: data.maxWinners,
          winnersCount: data.winnersCount,
          won: false,
          rewardCoins: null,
        };
        setDropSnap(snap);
      },
      onDropFinished: (dropId) => {
        setDropSnap((prev) =>
          prev?.hasActiveDrop && prev.dropId === dropId
            ? { hasActiveDrop: false }
            : prev
        );
        setDropOpen(false);
      },
      onDropClaimed: ({ dropId, reward }) => {
        setDropSnap((prev) =>
          prev?.hasActiveDrop && prev.dropId === dropId
            ? { ...prev, won: true, rewardCoins: reward }
            : prev
        );
      },
      onLiveStarted: (data) => {
        useLiveBroadcastStore.getState().applyLiveStartedFromWs(data);
      },
      onLiveEnded: () => {
        useLiveBroadcastStore.getState().applyLiveEndedFromWs();
      },
      onPredictionState: (data) => {
        usePredictionStore.getState().applyFromWs(data);
      },
      onOpen: () => {
        void refreshMeFromService();
        syncRealtimeFromHttp();
      },
      onLegacyBalancePing: () => void refreshMe(),
    },
    !needsPlatformLink && !!me
  );

  useEffect(() => {
    useLiveBroadcastStore.getState().setWsConnected(realtimeConnected);
  }, [realtimeConnected]);

  useEffect(() => {
    if (!me || needsPlatformLink) return;
    syncRealtimeFromHttp();
  }, [me, needsPlatformLink, syncRealtimeFromHttp]);

  useEffect(() => {
    if (needsPlatformLink) return;
    if (!docVisible) {
      tabWasHiddenRef.current = true;
      return;
    }
    if (tabWasHiddenRef.current) {
      tabWasHiddenRef.current = false;
      void refreshMe();
      syncRealtimeFromHttp({ force: true });
    }
  }, [docVisible, needsPlatformLink, refreshMe, syncRealtimeFromHttp]);

  /** Без WS — fallback-проверка каждые 2 мин чтобы не пропустить дроп. */
  useEffect(() => {
    if (!me || realtimeConnected) return;
    if (!docVisible) return;
    const t = window.setInterval(() => void loadDrop(), 120_000);
    return () => clearInterval(t);
  }, [me, realtimeConnected, docVisible, loadDrop]);

  useEffect(() => {
    if (needsPlatformLink) return;
    if (!docVisible) return;
    const ms = realtimeConnected ? 120_000 : 60_000;
    const id = window.setInterval(() => {
      void refreshMe();
    }, ms);
    return () => clearInterval(id);
  }, [
    needsPlatformLink,
    refreshMe,
    realtimeConnected,
    docVisible,
  ]);

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
    if (!dropSnap?.hasActiveDrop || dropSnap.won) return;
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

  const dropServerNow =
    dropSnap?.hasActiveDrop && dropSnap.serverNow
      ? dropSnap.serverNow
      : dropSnap?.hasActiveDrop
        ? new Date(
            Date.now() - dropSnap.remainingSeconds * 1000
          ).toISOString()
        : null;

  const dropRemainingMs = useSyncedCountdownMs(
    dropSnap?.hasActiveDrop ? dropSnap.endsAt : null,
    dropServerNow,
    dropTickerActive
  );

  const dropSecondsLeft = Math.max(0, Math.ceil(dropRemainingMs / 1000));

  const showDropTicker =
    Boolean(me) &&
    dropSnap?.hasActiveDrop === true &&
    !dropSnap.won;

  /** Пока идёт редирект OAuth — показываем полноэкранный спиннер, не welcome поверх. */
  const oauthInProgress = /^\/oauth\/(twitch|kick)/.test(location.pathname);
  const showWelcomeOverlay = needsPlatformLink && !oauthInProgress;

  return (
    <MeEconomySyncProvider>
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
          <Suspense fallback={<AppLoadingSpinner />}>
            <Routes>
              <Route
                path="/"
                element={
                  <HomePage
                    me={me}
                    realtimeWsConnected={realtimeConnected}
                  />
                }
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
        </main>

        {!needsPlatformLink ? (
        <div className="nav-wrap">
          <nav className="nav" aria-label="Основное меню">
            <NavLink
              end
              className={({ isActive }) => (isActive ? "active" : "")}
              to="/"
            >
              <Home className="nav__icon" aria-hidden />
              <span>Главная</span>
            </NavLink>
            <NavLink
              data-tour-target="nav-tasks"
              className={({ isActive }) => (isActive ? "active" : "")}
              to="/tasks"
            >
              <ListTodo className="nav__icon" aria-hidden />
              <span>Задания</span>
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? "active" : "")}
              to="/games"
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
          snapshot={dropSnap}
          onAfterClaim={(reward) => {
            setDropSnap((prev) =>
              prev?.hasActiveDrop
                ? { ...prev, won: true, rewardCoins: reward }
                : prev
            );
          }}
          onRefreshSnapshot={loadDrop}
        />
      ) : null}
    </>
    </MeEconomySyncProvider>
  );
}
