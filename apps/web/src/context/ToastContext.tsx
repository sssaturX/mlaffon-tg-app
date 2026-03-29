import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "info" | "success" | "error";

type ToastItem = { id: string; message: string; variant: ToastVariant };

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now());
      setToasts((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.variant}`} role="status">
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
