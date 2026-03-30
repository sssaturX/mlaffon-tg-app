import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { useActivePlatform } from "../context/PlatformContext";

export default function Games({ onRefresh }: { onRefresh: () => void }) {
  const { activePlatform } = useActivePlatform();
  const [status, setStatus] = useState<{
    utcDate: string;
    freeAvailable: boolean;
    paidSpinCost: number;
  } | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{
      utcDate: string;
      freeAvailable: boolean;
      paidSpinCost: number;
    }>("/api/v1/games/fortune");
    if (r.ok) {
      setStatus(r.data);
      setLoadErr(null);
    } else setLoadErr(formatApiError(r));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function spin(mode: "free" | "paid") {
    setLast(null);
    const r = await api<{
      outcome: string;
      amount?: number;
      coins: number;
    }>("/api/v1/games/fortune/spin", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    if (r.ok) {
      const o = r.data;
      setLast(
        o.outcome === "coins"
          ? `Выигрыш: ${o.amount ?? 0} монет`
          : o.outcome === "boost"
            ? "Выигрыш: буст ×2"
            : "Пусто"
      );
      await load();
      onRefresh();
    } else {
      setLast(formatApiError(r));
    }
  }

  return (
    <div>
      <div className="card stack">
        <h2>Колесо фортуны</h2>
        {loadErr && <p className="err">{loadErr}</p>}
        {status && (
          <p className="muted">
            Платформа: {activePlatform === "twitch" ? "Twitch" : "Kick"}. День
            (UTC): {status.utcDate}. Бесплатный спин:{" "}
            {status.freeAvailable ? "доступен" : "уже использован"}. Платный:{" "}
            {status.paidSpinCost} монет с баланса этой платформы.
          </p>
        )}
        <div className="row games-actions">
          <button
            type="button"
            className="primary"
            disabled={!status?.freeAvailable}
            onClick={() => spin("free")}
          >
            Бесплатный спин
          </button>
          <button type="button" onClick={() => spin("paid")}>
            Платный спин
          </button>
        </div>
        {last ? <p className="mt-2">{last}</p> : null}
      </div>
    </div>
  );
}
