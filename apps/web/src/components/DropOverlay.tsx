import { Gift, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import WebApp from "@twa-dev/sdk";
import { api } from "../api";

const DIGITS = 4;

export type DropSnapshot =
  | { hasActiveDrop: false }
  | {
      hasActiveDrop: true;
      dropId: string;
      endsAt: string;
      remainingSeconds: number;
      maxWinners: number;
      winnersCount: number;
      won: boolean;
      rewardCoins: number | null;
    };

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 220 + (h % 80);
}

function playWinSound() {
  try {
    const AC =
      typeof window !== "undefined" &&
      (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.06;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    }, 40);
    setTimeout(() => {
      o.stop();
      ctx.close().catch(() => {});
    }, 200);
  } catch {
    /* ignore */
  }
}

function haptic(kind: "light" | "medium" | "heavy" | "error") {
  try {
    const h = WebApp.HapticFeedback;
    if (kind === "error") h.notificationOccurred("error");
    else h.impactOccurred(kind);
  } catch {
    /* ignore */
  }
}

function formatMmSs(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function DropOverlay({
  open,
  onClose,
  snapshot,
  onAfterClaim,
  onRefreshSnapshot,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: DropSnapshot | null;
  onAfterClaim: () => void | Promise<void>;
  /** После ошибки ввода — обновить лимиты/кулдаун с сервера */
  onRefreshSnapshot?: () => void | Promise<void>;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(DIGITS).fill(""));
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [displayReward, setDisplayReward] = useState(0);
  const [tick, setTick] = useState(0);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setTick(0);
  }, [snapshot?.hasActiveDrop ? snapshot?.dropId : null]);

  useEffect(() => {
    if (!open || !snapshot?.hasActiveDrop) return;
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [open, snapshot]);

  const remaining =
    snapshot?.hasActiveDrop
      ? Math.max(0, snapshot.remainingSeconds - tick)
      : 0;

  const codeFilled = digits.join("").length >= DIGITS;
  /** Подсветка кнопки после первой введённой цифры — не гаснет после нажатия (нет кулдауна). */
  const submitGlow = digits.some((d) => d !== "") && !submitting;

  const resetInput = useCallback(() => {
    setDigits(Array(DIGITS).fill(""));
    setErr(null);
    setShake(false);
  }, []);

  useEffect(() => {
    if (!open) {
      resetInput();
      setDisplayReward(0);
      return;
    }
    resetInput();
    const t = setTimeout(() => inputsRef.current[0]?.focus(), 350);
    return () => clearTimeout(t);
  }, [open, resetInput]);

  useEffect(() => {
    if (!open || !snapshot?.hasActiveDrop || !snapshot.won || snapshot.rewardCoins == null) {
      return;
    }
    let frame = 0;
    const target = snapshot.rewardCoins;
    const dur = 900;
    const start = performance.now();
    const stepAnim = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - p) ** 3;
      setDisplayReward(Math.round(target * eased));
      if (p < 1) {
        frame = requestAnimationFrame(stepAnim);
      } else {
        setDisplayReward(target);
        playWinSound();
      }
    };
    frame = requestAnimationFrame(stepAnim);
    return () => cancelAnimationFrame(frame);
  }, [open, snapshot]);

  const setDigit = (i: number, ch: string) => {
    const d = ch.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    setErr(null);
    if (d && i < DIGITS - 1) inputsRef.current[i + 1]?.focus();
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const t = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, DIGITS);
    const arr = t.split("");
    while (arr.length < DIGITS) arr.push("");
    setDigits(arr.slice(0, DIGITS).map((c) => c || ""));
    const last = Math.min(t.length, DIGITS) - 1;
    if (last >= 0) inputsRef.current[last]?.focus();
  };

  async function submit() {
    const code = digits.join("");
    if (code.length < DIGITS) {
      setErr("Введите 4 цифры");
      return;
    }
    setSubmitting(true);
    setErr(null);
    const r = await api<{ ok: boolean; reward?: number }>("/api/v1/drops/attempt", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    setSubmitting(false);
    if (r.ok && r.data.ok && typeof r.data.reward === "number") {
      haptic("heavy");
      setDisplayReward(0);
      await Promise.resolve(onAfterClaim());
      return;
    }
    const body = !r.ok
      ? (r.err as { error?: string; message?: string })
      : null;
    const codeErr = body?.error;
    haptic("error");
    setShake(true);
    setTimeout(() => setShake(false), 500);
    setDigits(Array(DIGITS).fill(""));
    if (codeErr === "wrong_code") {
      setErr("Неверный код");
    } else if (codeErr === "pool_full") {
      setErr("Места закончились");
    } else if (codeErr === "already_won") {
      setErr("Уже получено");
    } else {
      setErr(body?.message ?? "Ошибка");
    }
    queueMicrotask(() => inputsRef.current[0]?.focus());
    await Promise.resolve(onRefreshSnapshot?.());
  }

  if (!open) return null;

  if (!snapshot) {
    return (
      <div className="drop-overlay" role="presentation">
        <div className="drop-overlay__backdrop" aria-hidden />
        <div className="drop-overlay__card drop-overlay__card--appear">
          <button
            type="button"
            className="drop-overlay__close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={22} />
          </button>
          <p className="muted drop-overlay__loading">Загрузка…</p>
        </div>
      </div>
    );
  }

  const hue = snapshot.hasActiveDrop ? hashHue(snapshot.dropId) : 250;

  return (
    <div
      className="drop-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drop-overlay__backdrop" aria-hidden />
      <div
        className={`drop-overlay__card drop-overlay__card--appear ${shake ? "drop-overlay__card--shake" : ""}`}
        style={{
          ["--drop-hue" as string]: `${hue}`,
        }}
      >
        <button
          type="button"
          className="drop-overlay__close"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <X size={22} />
        </button>

        {!snapshot.hasActiveDrop ? (
          <div className="drop-overlay__body">
            <p className="drop-overlay__badge">⏳</p>
            <h2 className="drop-overlay__title">Дроп завершён</h2>
            <p className="drop-overlay__sub">Попробуй в следующий раз</p>
            <button type="button" className="primary drop-overlay__btn" onClick={onClose}>
              Ок
            </button>
          </div>
        ) : snapshot.won ? (
          <div className="drop-overlay__body">
            <div className="drop-overlay__confetti" aria-hidden>
              {Array.from({ length: 14 }).map((_, i) => (
                <span key={i} className={`drop-overlay__confetti-bit drop-overlay__confetti-bit--${i % 5}`} />
              ))}
            </div>
            <p className="drop-overlay__badge">🎉</p>
            <h2 className="drop-overlay__title">Поздравляем</h2>
            <p className="drop-overlay__sub">Ты получил:</p>
            <p className="drop-overlay__reward">
              💰 {displayReward.toLocaleString("ru-RU")} монет
            </p>
            <button
              type="button"
              className="primary drop-overlay__btn drop-overlay__btn--pulse"
              onClick={onClose}
            >
              Забрать
            </button>
          </div>
        ) : (
          <div className="drop-overlay__body">
            <p className="drop-overlay__badge">
              <Gift size={28} strokeWidth={2} aria-hidden />
            </p>
            <h2 className="drop-overlay__title">Drop активен</h2>
            <p className="drop-overlay__sub">Введи код со стрима</p>

            <div className="drop-overlay__timer">
              Осталось: <strong>{formatMmSs(remaining)}</strong>
            </div>

            <div className={`drop-overlay__otp ${shake ? "drop-overlay__otp--shake" : ""}`} onPaste={onPaste}>
              {Array.from({ length: DIGITS }).map((_, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  className="drop-overlay__cell"
                  inputMode="numeric"
                  maxLength={1}
                  value={digits[i]}
                  aria-label={`Цифра ${i + 1}`}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                />
              ))}
            </div>

            {err ? <p className="drop-overlay__err">{err}</p> : null}

            <button
              type="button"
              className={`primary drop-overlay__btn${submitGlow ? " drop-overlay__btn--pulse" : ""}`}
              disabled={submitting || !codeFilled}
              onClick={() => void submit()}
            >
              {submitting ? "…" : "Получить награду"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
