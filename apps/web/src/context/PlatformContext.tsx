import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type ActivePlatform = "twitch" | "kick";

const STORAGE_KEY = "mlaffon_active_platform";

type Ctx = {
  activePlatform: ActivePlatform;
  setActivePlatform: (p: ActivePlatform) => void;
};

const PlatformContext = createContext<Ctx | null>(null);

/** Для prefetch вне React (NavLink hover и т.п.). */
export function getStoredActivePlatform(): ActivePlatform {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s === "kick" ? "kick" : "twitch";
  } catch {
    return "twitch";
  }
}

function readStored(): ActivePlatform {
  return getStoredActivePlatform();
}

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [activePlatform, setState] = useState<ActivePlatform>(readStored);

  const setActivePlatform = useCallback((p: ActivePlatform) => {
    setState(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ activePlatform, setActivePlatform }),
    [activePlatform, setActivePlatform]
  );

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}

export function useActivePlatform(): Ctx {
  const x = useContext(PlatformContext);
  if (!x) {
    throw new Error("useActivePlatform must be used within PlatformProvider");
  }
  return x;
}
