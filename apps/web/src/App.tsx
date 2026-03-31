import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom/client";
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
import type { MeResponse } from "shared";
import {
  api,
  authDev,
  authTelegram,
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
import { DropOverlay, type DropSnapshot } from "./components/DropOverlay";
import { DropTicker } from "./components/DropTicker";

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
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const refreshMe = useCallback(async (): Promise<MeResponse | null> => {
    if (!getToken()) {
      flushSync(() => setMe(null));
      return null;
    }
    const r = await api<MeResponse>("/api/v1/me");
    if (r.ok) {
      flushSync(() => {
        setMe(r.data);
      });
      return r.data;
    }
    if (r.networkError) {
      showToast(formatApiError(r), "error");
      return null;
    }
    flushSync(() => {
      setMe(null);
    });
    setToken(null);
    showToast(formatApiError(r), "error");
    return null;
  }, [showToast]);

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
      const existing = getToken();
      if (existing) {
        const r = await api<MeResponse>("/api/v1/me");
        if (cancelled) return;
        if (r.ok) {
          setMe(r.data);
        } else if (r.networkError) {
          showToast(formatApiError(r), "error");
        } else {
          setMe(null);
          setToken(null);
          showToast(formatApiError(r), "error");
        }
        setReady(true);
        return;
      }

      const initData = WebApp.initData;
      if (initData) {
        const r = await authTelegram(initData);
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
              Для продакшена откройте мини-приложение из бота. Для локальной
              разработки: <code>ALLOW_DEV_AUTH=1</code> в API и{" "}
              <code>npm run dev</code> — тогда подставится тестовый пользователь.
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
      me={me}
      needsPlatformLink={!hasLinkedStreamingAccount(me)}
      online={online}
      onboardingOpen={onboardingOpen}
      onCloseOnboarding={() => setOnboardingOpen(false)}
      onShowOnboarding={() => setOnboardingOpen(true)}
      refreshMe={refreshMe}
    />
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
  refreshMe,
}: {
  me: MeResponse;
  /** Полноэкранный экран привязки Kick/Twitch до первого OAuth. */
  needsPlatformLink: boolean;
  online: boolean;
  onboardingOpen: boolean;
  onCloseOnboarding: () => void;
  onShowOnboarding: () => void;
  refreshMe: () => Promise<MeResponse | null>;
}) {
  const location = useLocation();
  const { activePlatform } = useActivePlatform();
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const [dropSnap, setDropSnap] = useState<DropSnapshot | null>(null);
  const [dropOpen, setDropOpen] = useState(false);

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

  const headerBalance =
    activePlatform === "twitch" ? me.coinsTwitch : me.coinsKick;

  useEffect(() => {
    const theme = getPlatformTheme(activePlatform);
    document.documentElement.setAttribute("data-platform-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-platform-theme");
    };
  }, [activePlatform]);

  useEffect(() => {
    if (!me || needsPlatformLink) return;
    void loadDrop();
    const t = window.setInterval(() => void loadDrop(), 8000);
    return () => clearInterval(t);
  }, [me, loadDrop, needsPlatformLink]);

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

  const [dropSecTick, setDropSecTick] = useState(0);
  useEffect(() => {
    setDropSecTick(0);
  }, [dropSnap?.hasActiveDrop ? dropSnap?.dropId : null]);

  useEffect(() => {
    if (!dropSnap?.hasActiveDrop || dropSnap.won) return;
    const id = window.setInterval(() => setDropSecTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [dropSnap]);

  const dropSecondsLeft =
    dropSnap?.hasActiveDrop && !dropSnap.won
      ? Math.max(0, dropSnap.remainingSeconds - dropSecTick)
      : 0;

  const showDropTicker =
    !needsPlatformLink &&
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
            balance={headerBalance}
          />
        ) : null}

        <main key={location.pathname} className="app-main">
          <Suspense fallback={<AppLoadingSpinner />}>
            <Routes>
              <Route path="/" element={<HomePage me={me} onRefresh={refreshMe} />} />
              <Route path="/giveaways" element={<GiveawaysPage me={me} />} />
              <Route
                path="/giveaway/:id"
                element={<GiveawayPage me={me} onRefresh={refreshMe} />}
              />
              <Route path="/tasks" element={<Tasks onRefresh={refreshMe} />} />
              <Route path="/games" element={<Games onRefresh={refreshMe} />} />
              <Route path="/shop" element={<Shop onRefresh={refreshMe} />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route
                path="/oauth/:platform"
                element={<OAuthReturn onRefresh={refreshMe} />}
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
            <WelcomeGate me={me} onRefresh={refreshMe} />
          </Suspense>
        </div>
      ) : null}

      {!needsPlatformLink && me ? (
        <DropOverlay
          open={dropOpen}
          onClose={() => setDropOpen(false)}
          snapshot={dropSnap}
          onAfterClaim={async () => {
            await loadDrop();
            await refreshMe();
          }}
          onRefreshSnapshot={loadDrop}
        />
      ) : null}
    </>
  );
}
