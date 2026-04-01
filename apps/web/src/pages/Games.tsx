import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatApiError } from "../api";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { useActivePlatform } from "../context/PlatformContext";
import { AppLoadingSpinner } from "../components/AppLoadingSpinner";
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

function formatSpinResult(data: {
  outcome: string;
  amount?: number;
}): string {
  if (data.outcome === "coins")
    return `Выпало: ${data.amount ?? 0} монет на баланс платформы`;
  if (data.outcome === "boost") return "Выпало: буст ×2 в инвентарь";
  return "Выпало: без приза — удачи в следующий раз";
}

export default function Games() {
  const { patchMe } = useMeEconomySync();
  const { activePlatform } = useActivePlatform();
  const [status, setStatus] = useState<FortuneStatus | null>(null);
  const [rotation, setRotation] = useState(0);
  const rotationRef = useRef(0);
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const pendingMsgRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<FortuneStatus>("/api/v1/games/fortune");
    if (r.ok) {
      setStatus(r.data);
      setLoadErr(null);
    } else setLoadErr(formatApiError(r));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function spin(mode: "free" | "paid") {
    if (spinning || !status?.segments.length) return;
    setLast(null);
    setSpinning(true);
    pendingMsgRef.current = null;

    const r = await api<{
      segmentIndex: number;
      outcome: string;
      amount?: number;
      coins: number;
      coinsTwitch: number;
      coinsKick: number;
    }>("/api/v1/games/fortune/spin", {
      method: "POST",
      body: JSON.stringify({ mode, platform: activePlatform }),
    });

    if (!r.ok) {
      setSpinning(false);
      setLast(formatApiError(r));
      return;
    }

    const n = status.segments.length;
    const next = nextRotationDeg(
      rotationRef.current,
      r.data.segmentIndex,
      n,
      5
    );
    rotationRef.current = next;
    setRotation(next);

    const msg = formatSpinResult(r.data);
    pendingMsgRef.current = msg;

    window.setTimeout(() => {
      setSpinning(false);
      if (pendingMsgRef.current) {
        setLast(pendingMsgRef.current);
        pendingMsgRef.current = null;
      }
      void load();
      patchMe(() => ({
        coins: r.data.coins,
        coinsTwitch: r.data.coinsTwitch,
        coinsKick: r.data.coinsKick,
      }));
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

            {last ? (
              <p className="games-result" role="status">
                {last}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
