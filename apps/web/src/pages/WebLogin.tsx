import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  authLogin,
  authRegister,
  formatApiError,
  setToken,
} from "../api";

const REF_STORAGE_KEY = "mlaffon_pending_ref";

type Mode = "login" | "register";

export function WebLogin({
  onLoggedIn,
}: {
  onLoggedIn: () => void | Promise<void>;
}) {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = searchParams.get("ref")?.trim();
    if (q && q.length > 0) {
      try {
        sessionStorage.setItem(REF_STORAGE_KEY, q);
      } catch {
        /* ignore */
      }
    }
  }, [searchParams]);

  const pendingRef = useMemo(() => {
    const fromUrl = searchParams.get("ref")?.trim();
    if (fromUrl && fromUrl.length > 0) return fromUrl;
    try {
      return sessionStorage.getItem(REF_STORAGE_KEY)?.trim() ?? null;
    } catch {
      return null;
    }
  }, [searchParams]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r =
        mode === "register"
          ? await authRegister(email, password, pendingRef)
          : await authLogin(email, password);
      if (!r.ok) {
        setErr(formatApiError(r));
        return;
      }
      if (mode === "register") {
        try {
          sessionStorage.removeItem(REF_STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
      setToken(r.data.token);
      await onLoggedIn();
    } catch {
      setErr("Ошибка сети");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-main">
        <div className="card stack login-card">
          <h1>{mode === "login" ? "Вход" : "Регистрация"}</h1>
          <p className="muted">
            Один прогресс везде: с сайта — в профиле «Привязать Telegram»; из
            Telegram — в профиле задайте email и пароль для входа в браузере.
          </p>
          {err && <p className="err">{err}</p>}
          {mode === "register" && pendingRef ? (
            <p className="muted small m-0">
              Регистрация по приглашению — бонус начислится по правилам сервиса после
              проверок.
            </p>
          ) : null}
          <form className="stack" onSubmit={submit}>
            <label className="stack gap-0">
              <span className="muted small">Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="stack gap-0">
              <span className="muted small">Пароль (не менее 8 символов)</span>
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={busy}
              />
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>
          <p className="muted">
            {mode === "login" ? (
              <>
                Нет аккаунта?{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setMode("register");
                    setErr(null);
                  }}
                >
                  Регистрация
                </button>
              </>
            ) : (
              <>
                Уже есть аккаунт?{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setMode("login");
                    setErr(null);
                  }}
                >
                  Войти
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
