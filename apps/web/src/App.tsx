import { useCallback, useEffect, useState } from "react";
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
import HomePage from "./pages/Home";
import Tasks from "./pages/Tasks";
import Games from "./pages/Games";
import Shop from "./pages/Shop";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import OAuthReturn from "./pages/OAuthReturn";
import OAuthBrowserDone from "./pages/OAuthBrowserDone";
import GiveawayPage from "./pages/Giveaway";
import { DropOverlay, type DropSnapshot } from "./components/DropOverlay";

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

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      return;
    }
    const r = await api<MeResponse>("/api/v1/me");
    if (r.ok) {
      setMe(r.data);
      return;
    }
    if (r.networkError) {
      showToast(formatApiError(r), "error");
      return;
    }
    setMe(null);
    setToken(null);
    showToast(formatApiError(r), "error");
  }, [showToast]);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    /* Режим не fullscreen — сверху панель Telegram (закрыть / ⋮). */
    try {
      const wa = WebApp as { isFullscreen?: boolean; exitFullscreen?: () => void };
      if (wa.isFullscreen === true && typeof wa.exitFullscreen === "function") {
        wa.exitFullscreen();
      }
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
    if (!ready || !getToken()) return;
    if (!hasSeenOnboarding()) setOnboardingOpen(true);
  }, [ready]);

  if (!ready) {
    return (
      <div className="app-shell">
        <div className="app-main">
          <div className="card login-card">
            <p className="muted">Загрузка…</p>
          </div>
        </div>
      </div>
    );
  }

  const oauthPathOk = /^\/oauth\/(twitch|kick)\/?$/.test(location.pathname);
  const oauthHasResult =
    searchParams.get("connected") === "1" ||
    Boolean(searchParams.get("error")?.length);
  const oauthExternalNoToken =
    oauthPathOk && oauthHasResult && !getToken();

  if (oauthExternalNoToken) {
    return <OAuthBrowserDone />;
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

  return (
    <AppShell
      me={me}
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
  online,
  onboardingOpen,
  onCloseOnboarding,
  onShowOnboarding,
  refreshMe,
}: {
  me: MeResponse | null;
  online: boolean;
  onboardingOpen: boolean;
  onCloseOnboarding: () => void;
  onShowOnboarding: () => void;
  refreshMe: () => void;
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
    if (!me || onboardingOpen) return;
    if (!hasSeenTour()) setTourOpen(true);
  }, [me, onboardingOpen]);

  useEffect(() => {
    if (tourOpen) setTourStep(0);
  }, [tourOpen]);

  const headerBalance =
    me != null
      ? activePlatform === "twitch"
        ? me.coinsTwitch
        : me.coinsKick
      : null;

  useEffect(() => {
    const theme = getPlatformTheme(activePlatform);
    document.documentElement.setAttribute("data-platform-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-platform-theme");
    };
  }, [activePlatform]);

  useEffect(() => {
    if (!me) return;
    void loadDrop();
    const t = window.setInterval(() => void loadDrop(), 8000);
    return () => clearInterval(t);
  }, [me, loadDrop]);

  useEffect(() => {
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
  }, [dropSnap]);

  useEffect(() => {
    if (dropOpen && me) void loadDrop();
  }, [dropOpen, me, loadDrop]);

  const openDrop = useCallback(() => {
    void loadDrop();
    setDropOpen(true);
  }, [loadDrop]);

  return (
    <>
      {!online && (
        <div className="offline-banner" role="status">
          Нет сети — проверьте подключение
        </div>
      )}

      <OnboardingModal open={onboardingOpen} onClose={onCloseOnboarding} />

      <FirstVisitTour
        open={tourOpen}
        step={tourStep}
        onStepChange={setTourStep}
        onClose={() => setTourOpen(false)}
      />

      <div className="app-shell">
        <ScreenHeader
          title={routeTitle(location.pathname)}
          balance={headerBalance}
          dropActive={
            dropSnap?.hasActiveDrop === true && !dropSnap.won
          }
          onDropClick={me ? openDrop : undefined}
        />

        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage me={me} onRefresh={refreshMe} />} />
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
        </main>

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
      </div>

      {me ? (
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
