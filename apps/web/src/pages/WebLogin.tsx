import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Lock, LogIn, Mail, UserPlus } from "lucide-react";
import {
  authLogin,
  authRegister,
  formatApiError,
  setToken,
} from "../api";
import {
  evaluatePasswordStrength,
  passwordMeetsPolicy,
} from "../utils/passwordStrength";
import { useToast } from "../context/ToastContext";

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
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const strength = useMemo(
    () => evaluatePasswordStrength(password),
    [password]
  );

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

  function switchMode(next: Mode) {
    setMode(next);
    setErr(null);
    setPassword("");
    setPasswordConfirm("");
    setShowPassword(false);
    setShowPasswordConfirm(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (mode === "register") {
      if (password !== passwordConfirm) {
        const m = "Пароли не совпадают";
        setErr(m);
        showToast(m, "error");
        return;
      }
      if (!passwordMeetsPolicy(strength)) {
        const m = "Пароль слишком простой — усильте по подсказкам ниже";
        setErr(m);
        showToast(m, "error");
        return;
      }
    }

    setBusy(true);
    try {
      const r =
        mode === "register"
          ? await authRegister(email, password, pendingRef)
          : await authLogin(email, password);
      if (!r.ok) {
        const m = formatApiError(r);
        setErr(m);
        showToast(m, "error");
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
      const m = "Нет соединения с интернетом. Проверьте сеть и попробуйте снова.";
      setErr(m);
      showToast(m, "error");
    } finally {
      setBusy(false);
    }
  }

  const registerSubmitDisabled =
    busy ||
    (mode === "register" &&
      (!passwordMeetsPolicy(strength) || password !== passwordConfirm));

  return (
    <div className="auth-page">
      <div className="auth-page__glow" aria-hidden />
      <div className="auth-page__inner">
        <div className="auth-card card stack">
          <div className="auth-card__brand">
            <span className="auth-card__logo" aria-hidden>
              <img
                className="auth-card__logo-img"
                src="/streamer-kick.jpg"
                alt=""
                width={48}
                height={48}
              />
            </span>
            <div>
              <p className="auth-card__eyebrow">Mlaffon</p>
              <h1 className="auth-card__title">
                {mode === "login" ? "С возвращением" : "Создать аккаунт"}
              </h1>
            </div>
          </div>

          <p className="auth-card__lead muted">
            {mode === "login"
              ? "Войдите по email — прогресс синхронизируется с мини-приложением после привязки Telegram."
              : "Регистрация по email. Позже в профиле можно привязать Telegram для того же аккаунта."}
          </p>

          <div className="auth-segment" role="tablist" aria-label="Режим">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "on" : ""}
              onClick={() => switchMode("login")}
            >
              <LogIn size={16} aria-hidden />
              Вход
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={mode === "register" ? "on" : ""}
              onClick={() => switchMode("register")}
            >
              <UserPlus size={16} aria-hidden />
              Регистрация
            </button>
          </div>

          {err ? (
            <div className="auth-alert" role="alert">
              {err}
            </div>
          ) : null}

          {mode === "register" && pendingRef ? (
            <p className="auth-invite-banner muted small m-0">
              Приглашение активно — бонус начислится по правилам сервиса после
              проверок.
            </p>
          ) : null}

          <form className="auth-form stack" onSubmit={submit} noValidate>
            <label className="auth-field">
              <span className="auth-field__label">
                <Mail size={14} aria-hidden />
                Email
              </span>
              <input
                className="auth-field__input"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={busy}
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">
                <Lock size={14} aria-hidden />
                Пароль
              </span>
              <div className="auth-field__wrap">
                <input
                  className="auth-field__input auth-field__input--padded-right"
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "register"
                      ? "Минимум 8 символов, сложнее — лучше"
                      : "••••••••"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  {...(mode === "register" ? { minLength: 8 } : {})}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="auth-field__reveal"
                  tabIndex={-1}
                  aria-label={
                    showPassword ? "Скрыть пароль" : "Показать пароль"
                  }
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={busy}
                >
                  {showPassword ? (
                    <EyeOff size={18} strokeWidth={2} />
                  ) : (
                    <Eye size={18} strokeWidth={2} />
                  )}
                </button>
              </div>
            </label>

            {mode === "register" ? (
              <div className="auth-register-block">
                <div className="auth-strength">
                  <div className="auth-strength__head">
                    <span className="muted small">Надёжность</span>
                    <span
                      className={`auth-strength__badge auth-strength__badge--${strength.level}`}
                    >
                      {strength.labelRu}
                    </span>
                  </div>
                  <div
                    className="auth-strength__track"
                    role="progressbar"
                    aria-valuenow={strength.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Надёжность пароля"
                  >
                    <div
                      className={`auth-strength__fill auth-strength__fill--${strength.level}`}
                      style={{ width: `${strength.percent}%` }}
                    />
                  </div>
                  <ul className="auth-checklist muted small">
                    <li
                      className={
                        strength.checks.minLength ? "is-done" : undefined
                      }
                    >
                      Не менее 8 символов
                    </li>
                    <li
                      className={
                        strength.checks.hasLower && strength.checks.hasUpper
                          ? "is-done"
                          : undefined
                      }
                    >
                      Буквы разного регистра
                    </li>
                    <li
                      className={strength.checks.hasDigit ? "is-done" : undefined}
                    >
                      Есть цифра
                    </li>
                    <li
                      className={
                        strength.checks.hasSpecial ? "is-done" : undefined
                      }
                    >
                      Спецсимвол (!@#…)
                    </li>
                  </ul>
                </div>

                <label className="auth-field">
                  <span className="auth-field__label">
                    <Lock size={14} aria-hidden />
                    Подтверждение пароля
                  </span>
                  <div className="auth-field__wrap">
                    <input
                      className="auth-field__input auth-field__input--padded-right"
                      type={showPasswordConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Повторите пароль"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      required
                      minLength={8}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="auth-field__reveal"
                      tabIndex={-1}
                      aria-label={
                        showPasswordConfirm
                          ? "Скрыть пароль"
                          : "Показать пароль"
                      }
                      onClick={() => setShowPasswordConfirm((v) => !v)}
                      disabled={busy}
                    >
                      {showPasswordConfirm ? (
                        <EyeOff size={18} strokeWidth={2} />
                      ) : (
                        <Eye size={18} strokeWidth={2} />
                      )}
                    </button>
                  </div>
                </label>
                {passwordConfirm.length > 0 && password !== passwordConfirm ? (
                  <p className="auth-hint auth-hint--warn small m-0">
                    Пароли должны совпадать
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              type="submit"
              className="btn primary auth-submit"
              disabled={mode === "register" ? registerSubmitDisabled : busy}
            >
              {busy
                ? "…"
                : mode === "login"
                  ? "Войти"
                  : "Зарегистрироваться"}
            </button>
          </form>

          <p className="auth-footnote muted small m-0">
            Один прогресс везде: в профиле привяжите Telegram или задайте вход
            на сайте — в зависимости от того, с чего начали.
          </p>
        </div>
      </div>
    </div>
  );
}
