import { useCallback, useEffect, useState } from "react";
import { Coins, Lightbulb } from "lucide-react";
import type { Platform, TaskDto } from "shared";
import { api, formatApiError } from "../api";

const platforms = ["all", "global", "twitch", "kick"] as const;

function platformPillClass(p: Platform): string {
  if (p === "twitch") return "pill pill--twitch";
  if (p === "kick") return "pill pill--kick";
  return "pill pill--global";
}

function platformLabel(p: Platform): string {
  if (p === "global") return "Global";
  return p[0]!.toUpperCase() + p.slice(1);
}

export default function Tasks({ onRefresh }: { onRefresh: () => void }) {
  const [pf, setPf] = useState<(typeof platforms)[number]>("all");
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = pf === "all" ? "" : `?platform=${pf}`;
    const r = await api<{ tasks: TaskDto[] }>(`/api/v1/tasks${q}`);
    if (r.ok) {
      setTasks(r.data.tasks);
      setMsg(null);
    } else setMsg(formatApiError(r));
  }, [pf]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(id: string) {
    setMsg(null);
    const r = await api<{
      reward?: number;
      coins?: number;
      status?: string;
      jobId?: string;
    }>(`/api/v1/tasks/${id}/claim`, { method: "POST" });
    if (r.ok) {
      if (r.data.status === "pending") {
        setMsg(
          "Задание в очереди на проверку. Обновите через несколько секунд."
        );
        await load();
        onRefresh();
        return;
      }
      setMsg(`+${r.data.reward ?? 0} монет`);
      await load();
      onRefresh();
    } else {
      setMsg(formatApiError(r));
    }
  }

  return (
    <div>
      <div className="task-hint" role="note">
        <Lightbulb
          size={20}
          style={{ flexShrink: 0, marginTop: 2 }}
          aria-hidden
        />
        <span>
          Дополнительные задания могут появляться во время стрима. Подключите
          Twitch или Kick в профиле для проверок через API.
        </span>
      </div>

      <div className="filters">
        {platforms.map((p) => (
          <button
            key={p}
            type="button"
            className={pf === p ? "on" : ""}
            onClick={() => setPf(p)}
          >
            {p === "all"
              ? "Все"
              : p === "global"
                ? "Global"
                : p[0]!.toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {msg && <p className="muted">{msg}</p>}

      <div className="stack">
        {tasks.map((t) => (
          <div
            key={t.id}
            className={`task-card ${t.validationType === "api" ? "task-card--border" : ""}`}
          >
            <div className="task-card__top">
              <div className="task-card__tags">
                <span className={platformPillClass(t.platform)}>
                  {platformLabel(t.platform)}
                </span>
                <span className="pill">{t.type === "daily" ? "Ежедневно" : "Разово"}</span>
                {t.validationType === "api" ? (
                  <span className="pill pill--accent">API</span>
                ) : null}
              </div>
              <div className="task-card__reward">
                <Coins size={18} strokeWidth={2.2} aria-hidden />
                {t.reward.toLocaleString("ru-RU")}
              </div>
            </div>
            <p className="task-card__title">{t.title}</p>
            <p className="task-card__desc">{t.description}</p>
            {t.lastError && (
              <p className="err" style={{ margin: "8px 0 0", fontSize: 13 }}>
                {t.lastError}
              </p>
            )}
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
              Статус: {t.userStatus}
            </p>
            <button
              type="button"
              className="primary"
              disabled={t.userStatus !== "available"}
              onClick={() => claim(t.id)}
            >
              {t.userStatus === "completed"
                ? "Готово"
                : t.userStatus === "locked"
                  ? "Нужна платформа (OAuth)"
                  : t.userStatus === "pending"
                    ? "Проверяется…"
                    : "Забрать"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
