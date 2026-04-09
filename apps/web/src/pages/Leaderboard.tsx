/** Не подключён в `App.tsx` (лидерборд скрыт); страница сохранена для возврата. */
import { useEffect, useState } from "react";
import { useActivePlatform } from "../context/PlatformContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { useLeaderboard } from "../hooks/queries/useLeaderboard";

export default function Leaderboard() {
  const { activePlatform } = useActivePlatform();
  const [sort, setSort] = useState<"coins" | "streak" | "referrals">("coins");
  const [platform, setPlatform] = useState<"all" | "twitch" | "kick">(
    activePlatform
  );

  useEffect(() => {
    setPlatform(activePlatform);
  }, [activePlatform]);

  const { data, isPending, isError, refetch, isFetching } = useLeaderboard(
    sort,
    platform
  );

  return (
    <div>
      {isError ? (
        <div className="card stack">
          <p className="err">Не удалось загрузить рейтинг.</p>
          <button
            type="button"
            className="primary"
            onClick={() => void refetch()}
          >
            Повторить
          </button>
        </div>
      ) : null}
      {isFetching && !isPending ? (
        <p className="muted">Обновляем рейтинг…</p>
      ) : null}
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

      {isPending && !data ? (
        <PageSkeleton />
      ) : null}

      {!isError && data?.me && (
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
