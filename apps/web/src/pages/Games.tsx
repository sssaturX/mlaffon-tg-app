import { useEffect, useMemo, useRef, useState } from "react";
import { TelegramWebApp as WebApp } from "../lib/telegramAdapter";
import { Sparkles, Ban } from "lucide-react";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";
import { AppLoadingSpinner } from "../components/AppLoadingSpinner";
import {
  useFortuneConfig,
  useFortuneState,
  useInvalidateFortuneState,
} from "../hooks/queries/useFortuneQueries";
import { ApiQueryError } from "../query/apiQueryError";
import {
  FortuneWheel,
  nextRotationDeg,
  type FortuneSegment,
} from "../components/FortuneWheel";

const SPIN_MS = 4200;

type FortuneStatus = {
  utcDate: string;
  freeAvailable: boolean;
  paidSpinCost: number;
  segments: FortuneSegment[];
};

type SpinReveal = {
  outcome: "coins" | "nothing";
  amount?: number;
  segmentLabel: string;
};

function SpinResultCard({ result }: { result: SpinReveal }) {
  if (result.outcome === "coins") {
    const n = result.amount ?? 0;
    return (
      <div className="games-win-card games-win-card--coins" role="status">
        <Sparkles className="games-win-card__icon" aria-hidden size={28} strokeWidth={2} />
        <p className="games-win-card__eyebrow">Выпало</p>
        <p className="games-win-card__value">
          +{n.toLocaleString("ru-RU")}{" "}
          <span className="games-win-card__unit">монет</span>
        </p>
        <p className="games-win-card__hint">{result.segmentLabel}</p>
      </div>
    );
  }
  return (
    <div className="games-win-card games-win-card--empty" role="status">
      <Ban className="games-win-card__icon games-win-card__icon--muted" aria-hidden size={26} strokeWidth={2} />
      <p className="games-win-card__eyebrow">В этот раз</p>
      <p className="games-win-card__value">Без приза</p>
      <p className="games-win-card__hint">Удачи в следующий раз</p>
    </div>
  );
}

export default function Games() {
  const { activePlatform } = useActivePlatform();
  const { showToast } = useToast();
  const fortuneConfigQ = useFortuneConfig();
  const fortuneStateQ = useFortuneState();
  const invalidateFortuneState = useInvalidateFortuneState();
  const status = useMemo((): FortuneStatus | null => {
    if (!fortuneConfigQ.data || !fortuneStateQ.data) return null;
    return {
      ...fortuneConfigQ.data,
      ...fortuneStateQ.data,
      segments: fortuneConfigQ.data.segments as FortuneSegment[],
    };
  }, [fortuneConfigQ.data, fortuneStateQ.data]);
  const loadErr =
    fortuneConfigQ.isError || fortuneStateQ.isError
      ? (() => {
          const e = fortuneConfigQ.error ?? fortuneStateQ.error;
          return e instanceof ApiQueryError
            ? formatApiError(e.apiErr)
            : "Не удалось загрузить игру";
        })()
      : null;
  const [rotation, setRotation] = useState(0);
  const rotationRef = useRef(0);
  const [spinning, setSpinning] = useState(false);
  const [lastReveal, setLastReveal] = useState<SpinReveal | null>(null);
  const [spinErr, setSpinErr] = useState<string | null>(null);
  const pendingRevealRef = useRef<SpinReveal | null>(null);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadErrToastKey = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (spinTimerRef.current) clearTimeout(spinTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!loadErr) {
      loadErrToastKey.current = null;
      return;
    }
    if (loadErrToastKey.current === loadErr) return;
    loadErrToastKey.current = loadErr;
    showToast(loadErr, "error");
  }, [loadErr, showToast]);

  async function spin(mode: "free" | "paid") {
    if (spinning || !status?.segments.length) return;
    setLastReveal(null);
    setSpinErr(null);
    setSpinning(true);
    pendingRevealRef.current = null;

    const r = await api<{
      segmentIndex: number;
      outcome: "coins" | "nothing";
      amount?: number;
    }>("/api/v1/games/fortune/spin", {
      method: "POST",
      body: JSON.stringify({ mode, platform: activePlatform }),
    });

    if (!r.ok) {
      setSpinning(false);
      const m = formatApiError(r);
      setSpinErr(m);
      showToast(m, "error");
      return;
    }

    const n = status.segments.length;
    const rawIdx = Number(r.data.segmentIndex);
    const idx =
      Number.isFinite(rawIdx) && rawIdx >= 0
        ? Math.min(n - 1, Math.floor(rawIdx))
        : 0;
    const seg = status.segments[idx];
    const reveal: SpinReveal = {
      outcome: r.data.outcome,
      amount: r.data.amount,
      segmentLabel: seg?.label ?? "Сектор",
    };
    pendingRevealRef.current = reveal;

    const next = nextRotationDeg(rotationRef.current, idx, n, 5);
    if (!Number.isFinite(next)) {
      setSpinning(false);
      setLastReveal(reveal);
      invalidateFortuneState();
      return;
    }
    rotationRef.current = next;
    /* Два rAF: в WebView иначе transition на transform иногда не стартует. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRotation(next);
      });
    });

    spinTimerRef.current = setTimeout(() => {
      spinTimerRef.current = null;
      setSpinning(false);
      if (pendingRevealRef.current) {
        setLastReveal(pendingRevealRef.current);
        pendingRevealRef.current = null;
        try {
          WebApp.HapticFeedback.notificationOccurred("success");
        } catch {
          /* ignore */
        }
      }
      invalidateFortuneState();
    }, SPIN_MS);
  }

  if (!status) {
    if (loadErr) {
      return (
        <div className="card">
          <p className="err">{loadErr}</p>
        </div>
      );
    }
    return <AppLoadingSpinner />;
  }

  return (
    <div className="games-page">
      <div className="card stack games-fortune-card">
        <h2 className="games-fortune-title">Колесо фортуны</h2>
        {loadErr && <p className="err">{loadErr}</p>}
        {status && (
          <>
            <p className="muted games-fortune-meta">
              Платформа:{" "}
              <strong>{activePlatform === "twitch" ? "Twitch" : "Kick"}</strong>
              . День (UTC): {status.utcDate}. Бесплатный спин:{" "}
              {status.freeAvailable ? (
                <strong className="games-ok">доступен</strong>
              ) : (
                <span>уже использован</span>
              )}
              . Платный спин:{" "}
              <strong>{status.paidSpinCost}</strong> монет с баланса выбранной
              платформы.
            </p>

            <div className="games-wheel-block">
              <FortuneWheel
                segments={status.segments}
                rotationDeg={rotation}
                spinning={spinning}
              />
            </div>

            {spinErr ? (
              <p className="err games-spin-err" role="alert">
                {spinErr}
              </p>
            ) : null}

            <div className="row games-actions">
              <button
                type="button"
                className="primary games-spin-btn"
                disabled={!status.freeAvailable || spinning}
                onClick={() => void spin("free")}
              >
                Бесплатный спин
              </button>
              <button
                type="button"
                className="games-spin-btn games-spin-btn--paid"
                disabled={spinning}
                onClick={() => void spin("paid")}
              >
                Платный спин ({status.paidSpinCost} мон.)
              </button>
            </div>

            {lastReveal ? <SpinResultCard result={lastReveal} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
