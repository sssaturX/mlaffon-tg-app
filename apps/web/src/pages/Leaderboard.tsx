/** Не подключён в `App.tsx` (лидерборд скрыт); страница сохранена для возврата. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LeaderboardResponse } from "shared";
import { api, formatApiError } from "../api";
import { useActivePlatform } from "../context/PlatformContext";
import { PageSkeleton } from "../components/PageSkeleton";

export default function Leaderboard() {
  const { activePlatform } = useActivePlatform();
  const [sort, setSort] = useState<"coins" | "streak" | "referrals">("coins");
  const [platform, setPlatform] = useState<"all" | "twitch" | "kick">(
    activePlatform
  );

  useEffect(() => {
    setPlatform(activePlatform);
  }, [activePlatform]);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const firstLoadRef = useRef(true);

  const load = useCallback(async () => {
    setLoadErr(null);
    if (firstLoadRef.current) setLoading(true);
    else setRefreshing(true);
    const q = new URLSearchParams({ sort, platform });
    const r = await api<LeaderboardResponse>(
      `/api/v1/leaderboard?${q.toString()}`
    );
    if (r.ok) setData(r.data);
    else {
      setLoadErr(formatApiError(r));
    }
    setLoading(false);
    setRefreshing(false);
    firstLoadRef.current = false;
  }, [sort, platform]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      {loadErr && <p className="err">{loadErr}</p>}
      {refreshing ? <p className="muted">Обновляем рейтинг…</p> : null}
      <div className="filters">
        {(["coins", "streak", "referrals"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={sort === s ? "on" : ""}
            onClick={() => setSort(s)}
          >
            {s === "coins"
              ? "Монеты"
              : s === "streak"
                ? "Стрик"
                : "Рефералы"}
          </button>
        ))}
      </div>
      <div className="filters">
        {(["all", "twitch", "kick"] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={platform === p ? "on" : ""}
            onClick={() => setPlatform(p)}
          >
            {p === "all" ? "Все" : p}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <PageSkeleton />
      ) : null}

      {data?.me && (
        <div className="card row leader-row leader-row--highlight">
          <span>Вы</span>
          <span>
            #{data.me.rank} — {data.me.value}
          </span>
        </div>
      )}

      <div className="stack">
        {data?.top.map((e) => (
          <div key={e.userId} className="card row leader-row">
            <span>
              #{e.rank} {e.displayName}
            </span>
            <strong>{e.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
