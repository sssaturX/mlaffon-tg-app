import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "info" | "success" | "error";

export type ToastExtraOptions = {
  /** По умолчанию 4200 ms */
  durationMs?: number;
  /** Уведомления о стрике — дольше и с акцентом в стилях */
  streak?: boolean;
};

type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
  streak?: boolean;
};

const DEFAULT_DURATION_MS = 4200;

type ToastContextValue = {
  showToast: (
    message: string,
    variant?: ToastVariant,
    third?: number | ToastExtraOptions
  ) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function parseToastThird(third?: number | ToastExtraOptions): {
  durationMs: number;
  streak: boolean;
} {
  if (typeof third === "number") {
    return { durationMs: third, streak: false };
  }
  if (third && typeof third === "object") {
    return {
      durationMs: third.durationMs ?? DEFAULT_DURATION_MS,
      streak: third.streak ?? false,
    };
  }
  return { durationMs: DEFAULT_DURATION_MS, streak: false };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info", third?: number | ToastExtraOptions) => {
      const { durationMs, streak } = parseToastThird(third);
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now());
      setToasts((prev) => [...prev, { id, message, variant, streak }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast--${t.variant}${t.streak ? " toast--streak" : ""}`}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
