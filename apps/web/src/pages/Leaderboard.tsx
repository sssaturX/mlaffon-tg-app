import { useCallback, useEffect, useState } from "react";
import type { LeaderboardResponse } from "shared";
import { api, formatApiError } from "../api";

export default function Leaderboard() {
  const [sort, setSort] = useState<"coins" | "streak" | "referrals">("coins");
  const [platform, setPlatform] = useState<"all" | "twitch" | "kick">("all");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    const q = new URLSearchParams({ sort, platform });
    const r = await api<LeaderboardResponse>(
      `/api/v1/leaderboard?${q.toString()}`
    );
    if (r.ok) setData(r.data);
    else {
      setData(null);
      setLoadErr(formatApiError(r));
    }
  }, [sort, platform]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      {loadErr && <p className="err">{loadErr}</p>}
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

      {data?.me && (
        <div className="card row leader-row" style={{ borderColor: "var(--accent-glow)" }}>
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
