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
  Trophy,
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
import { useRealtimeWebSocket } from "./hooks/useRealtimeWebSocket";
import { useDocumentVisible } from "./hooks/useDocumentVisible";
import { useLiveBroadcastStore } from "./store/liveBroadcastStore";
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
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
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
          <div className="card stack login-card">
            <h1>Вход</h1>
            {error && <p className="err">{error}</p>}
            <p className="muted">
              Для продакшена откройте мини-приложение из бота или войдите на сайте
              (если включён веб-вход). Для локальной разработки:{" "}
              <code>ALLOW_DEV_AUTH=1</code> в API и <code>npm run dev</code> — тогда
              подставится тестовый пользователь.
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

  const loadDrop = useCallback(async () => {
    if (!getToken()) {
      setDropSnap(null);
      return;
    }
    const r = await api<DropSnapshot>("/api/v1/drops/active");
    if (r.ok) setDropSnap(r.data);
  }, []);

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
      onDropStarted: () => void loadDrop(),
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
      onOpen: () => {
        void refreshMeFromService();
        void loadDrop();
        void useLiveBroadcastStore.getState().hydrateFromApi();
      },
      onLegacyBalancePing: () => void refreshMe(),
    },
    !needsPlatformLink && !!me
  );

  useEffect(() => {
    useLiveBroadcastStore.getState().setWsConnected(realtimeConnected);
  }, [realtimeConnected]);

  useEffect(() => {
    if (needsPlatformLink) return;
    void useLiveBroadcastStore.getState().hydrateFromApi();
  }, [needsPlatformLink]);

  useEffect(() => {
    if (needsPlatformLink) return;
    if (!docVisible) {
      tabWasHiddenRef.current = true;
      return;
    }
    if (tabWasHiddenRef.current) {
      tabWasHiddenRef.current = false;
      void refreshMe();
      void loadDrop();
      void useLiveBroadcastStore.getState().hydrateFromApi();
    }
  }, [docVisible, needsPlatformLink, refreshMe, loadDrop]);

  useEffect(() => {
    if (needsPlatformLink) return;
    if (!docVisible) return;
    const ms = realtimeConnected ? 120_000 : 30_000;
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

  /**
   * Пуллим /drops/active: без WS — чаще; с WS — редко, но всё равно (если пропустили
   * drop_started через Redis/WS, пользователь не обязан быть в аппке в момент старта).
   */
  useEffect(() => {
    if (!me || needsPlatformLink) return;
    if (!docVisible) return;
    void loadDrop();
    const activeDrop =
      dropSnap?.hasActiveDrop === true && dropSnap.won !== true;
    const ms = realtimeConnected
      ? 45_000
      : activeDrop
        ? 8000
        : 30_000;
    const t = window.setInterval(() => void loadDrop(), ms);
    return () => clearInterval(t);
  }, [
    me,
    loadDrop,
    needsPlatformLink,
    docVisible,
    dropSnap?.hasActiveDrop,
    dropSnap?.won,
    dropSnap?.dropId,
    realtimeConnected,
  ]);

  useEffect(() => {
    if (needsPlatformLink) return;
    if (!dropSnap?.hasActiveDrop || dropSnap.won) return;
    try {
      const k = `mlaffon_drop_auto_${dropSnap.dropId}`;
      if (!sessionStorage.getItem(k)) {
        sessionStorage.setItem(k, "1");
        setDropOpen(true);
      }
    } catch {
      setDropOpen(true);
    }
  }, [dropSnap, needsPlatformLink]);

  useEffect(() => {
    if (needsPlatformLink) return;
    if (dropOpen && me) void loadDrop();
  }, [dropOpen, me, loadDrop, needsPlatformLink]);

  const openDrop = useCallback(() => {
    void loadDrop();
    setDropOpen(true);
  }, [loadDrop]);

  const dropTickerActive =
    Boolean(me) &&
    !needsPlatformLink &&
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
    !needsPlatformLink &&
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

        <main key={location.pathname} className="app-main">
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
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route
                path="/oauth/:platform"
                element={<OAuthReturn />}
              />
              <Route
                path="/profile"
                element={
                  <Profile
                    me={me}
                    onRefresh={refreshMe}
                    onShowOnboarding={onShowOnboarding}
                  />
                }
              />
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
              to="/leaderboard"
            >
              <Trophy className="nav__icon" aria-hidden />
              <span>Топ</span>
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

      {showWelcomeOverlay ? (
        <div className="welcome-gate-overlay">
          <Suspense fallback={<AppLoadingSpinner />}>
            <WelcomeGate me={me} />
          </Suspense>
        </div>
      ) : null}

      {!needsPlatformLink && me ? (
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
