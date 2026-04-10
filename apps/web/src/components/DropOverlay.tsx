import { Gift, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { api } from "../api";
import { useSyncedCountdownMs } from "../hooks/useSyncedCountdown";

const DIGITS = 4;

export type DropSnapshot =
  | { hasActiveDrop: false }
  | {
      hasActiveDrop: true;
      dropId: string;
      endsAt: string;
      /** Серверное время на момент ответа — для синхронизации таймера */
      serverNow?: string;
      remainingSeconds: number;
      platform?: "twitch" | "kick" | "both";
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
      (window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
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

function formatMmSsFromMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
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
  /** Reward после успешного attempt (без лишнего GET /drops/active). */
  onAfterClaim: (reward: number) => void | Promise<void>;
  onRefreshSnapshot?: () => void | Promise<void>;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(DIGITS).fill(""));
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [displayReward, setDisplayReward] = useState(0);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const submitRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    };
  }, []);

  const snapshotActive = snapshot?.hasActiveDrop === true ? snapshot : null;

  const active = open && !!snapshotActive && !snapshotActive.won;

  const endsAt = snapshotActive?.endsAt ?? null;
  const serverNowIso = snapshotActive
    ? snapshotActive.serverNow ??
      new Date(
        Date.now() - snapshotActive.remainingSeconds * 1000
      ).toISOString()
    : null;

  const remainingMs = useSyncedCountdownMs(endsAt, serverNowIso, active);
  const timeUp = !!snapshotActive && !snapshotActive.won && remainingMs <= 0;

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

  const submit = useCallback(async () => {
    const code = digits.join("");
    if (code.length < DIGITS) {
      setErr("Введите 4 цифры");
      return;
    }
    setSubmitting(true);
    setErr(null);
    const r = await api<{
      ok: boolean;
      reward?: number;
    }>("/api/v1/drops/attempt", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (r.ok && r.data.ok && typeof r.data.reward === "number") {
      haptic("heavy");
      setDisplayReward(0);
      setDigits(Array(DIGITS).fill(""));
      setSubmitting(false);
      await Promise.resolve(onAfterClaim(r.data.reward));
      return;
    }
    setSubmitting(false);
    const body = !r.ok
      ? (r.err as { error?: string; message?: string })
      : null;
    const codeErr = body?.error;
    haptic("error");
    setShake(true);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => {
      shakeTimerRef.current = null;
      setShake(false);
    }, 500);
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
  }, [digits, onAfterClaim, onRefreshSnapshot]);

  submitRef.current = submit;

  useEffect(() => {
    if (!open || !snapshotActive || snapshotActive.won) return;
    const code = digits.join("");
    if (code.length !== DIGITS || submitting) return;
    const t = window.setTimeout(() => void submitRef.current(), 100);
    return () => clearTimeout(t);
  }, [
    digits,
    submitting,
    open,
    snapshotActive,
  ]);

  useEffect(() => {
    if (!open || !snapshotActive || !snapshotActive.won || snapshotActive.rewardCoins == null) {
      return;
    }
    let frame = 0;
    const target = snapshotActive.rewardCoins;
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
  }, [open, snapshotActive]);

  useEffect(() => {
    if (!open || !snapshotActive?.won) return;
    const closeT = window.setTimeout(() => onClose(), 900);
    return () => clearTimeout(closeT);
  }, [open, onClose, snapshotActive]);

  useEffect(() => {
    if (!open || !timeUp) return;
    const closeT = window.setTimeout(() => onClose(), 750);
    return () => clearTimeout(closeT);
  }, [open, timeUp, onClose]);

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
        ) : timeUp ? (
          <div className="drop-overlay__body">
            <p className="drop-overlay__badge">⏳</p>
            <h2 className="drop-overlay__title">Время вышло</h2>
            <p className="drop-overlay__sub">Дроп завершился</p>
          </div>
        ) : snapshot.won ? (
          <div className="drop-overlay__body">
            <div className="drop-overlay__confetti" aria-hidden>
              {Array.from({ length: 14 }).map((_, i) => (
                <span
                  key={i}
                  className={`drop-overlay__confetti-bit drop-overlay__confetti-bit--${i % 5}`}
                />
              ))}
            </div>
            <p className="drop-overlay__badge">🎉</p>
            <h2 className="drop-overlay__title">Поздравляем</h2>
            <p className="drop-overlay__sub">Ты получил:</p>
            <p className="drop-overlay__reward">
              💰 {displayReward.toLocaleString("ru-RU")} монет
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Окно закроется автоматически…
            </p>
          </div>
        ) : (
          <div className="drop-overlay__body">
            <p className="drop-overlay__badge">
              <Gift size={28} strokeWidth={2} aria-hidden />
            </p>
            <h2 className="drop-overlay__title">Drop активен</h2>
            <p className="drop-overlay__sub">Введи код со стрима</p>

            <div className="drop-overlay__timer">
              Осталось: <strong>{formatMmSsFromMs(remainingMs)}</strong>
            </div>

            <div
              className={`drop-overlay__otp ${shake ? "drop-overlay__otp--shake" : ""}`}
              onPaste={(e) => {
                e.preventDefault();
                const t = e.clipboardData
                  .getData("text")
                  .replace(/\D/g, "")
                  .slice(0, DIGITS);
                const arr = t.split("");
                while (arr.length < DIGITS) arr.push("");
                setDigits(arr.slice(0, DIGITS).map((c) => c || ""));
                const last = Math.min(t.length, DIGITS) - 1;
                if (last >= 0) inputsRef.current[last]?.focus();
              }}
            >
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
                  onChange={(e) => {
                    const d = e.target.value.replace(/\D/g, "").slice(-1);
                    const next = [...digits];
                    next[i] = d;
                    setDigits(next);
                    setErr(null);
                    if (d && i < DIGITS - 1) inputsRef.current[i + 1]?.focus();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digits[i] && i > 0) {
                      inputsRef.current[i - 1]?.focus();
                    }
                  }}
                />
              ))}
            </div>

            {err ? <p className="drop-overlay__err">{err}</p> : null}

            {submitting ? (
              <p className="muted" style={{ margin: 0, textAlign: "center" }}>
                Отправка…
              </p>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 12, textAlign: "center" }}>
                Код отправится сам после ввода 4-й цифры
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
