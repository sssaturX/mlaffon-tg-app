import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Coins, Lightbulb } from "lucide-react";
import type { Platform, TaskDto } from "shared";
import { api, formatApiError } from "../api";
import { useActivePlatform } from "../context/PlatformContext";
import { TaskDetailModal } from "../components/TaskDetailModal";
import { useLiveBroadcastStore } from "../store/liveBroadcastStore";

function platformPillClass(p: Platform): string {
  if (p === "twitch") return "pill pill--twitch";
  if (p === "kick") return "pill pill--kick";
  if (p === "telegram") return "pill pill--telegram";
  return "pill pill--global";
}

function platformLabel(p: Platform): string {
  if (p === "global") return "Global";
  if (p === "telegram") return "Telegram";
  return p[0]!.toUpperCase() + p.slice(1);
}

function TaskListSkeleton() {
  return (
    <div className="task-list-skeleton" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="task-card task-card--skeleton">
          <div className="skeleton task-skeleton__line task-skeleton__line--short" />
          <div className="skeleton task-skeleton__line" />
          <div className="skeleton task-skeleton__line task-skeleton__line--medium" />
        </div>
      ))}
    </div>
  );
}

export default function Tasks({ onRefresh }: { onRefresh: () => void }) {
  const wsConnected = useLiveBroadcastStore((s) => s.wsConnected);
  const { activePlatform } = useActivePlatform();
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TaskDto | null>(null);
  const [modalMsg, setModalMsg] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<{ tasks: TaskDto[] }>(
      `/api/v1/tasks?platform=${activePlatform}`
    );
    if (r.ok) {
      setTasks(r.data.tasks);
      setMsg(null);
    } else setMsg(formatApiError(r));
    setLoading(false);
  }, [activePlatform]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const fresh = tasks.find((t) => t.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [tasks, selected?.id]);

  async function claim(id: string) {
    setModalMsg(null);
    setMsg(null);
    setClaiming(true);
    const r = await api<{
      reward?: number;
      coins?: number;
      status?: string;
      jobId?: string;
    }>(`/api/v1/tasks/${id}/claim`, { method: "POST" });
    setClaiming(false);
    if (r.ok) {
      if (r.data.status === "pending") {
        const m =
          "Задание в очереди на проверку. Обновите через несколько секунд.";
        setModalMsg(m);
        setMsg(m);
        await load();
        onRefresh();
        return;
      }
      const okMsg = `+${r.data.reward ?? 0} монет`;
      setModalMsg(okMsg);
      setMsg(okMsg);
      await load();
      if (!wsConnected) {
        onRefresh();
      }
    } else {
      const err = formatApiError(r);
      setModalMsg(err);
      setMsg(err);
    }
  }

  return (
    <div>
      <div className="task-hint" role="note">
        <Lightbulb size={20} className="task-hint__icon" aria-hidden />
        <span>
          Список для платформы в шапке ({activePlatform === "twitch" ? "Twitch" : "Kick"}) плюс
          общие и Telegram. Нажмите на карточку — откроются детали, ссылка и проверка.
        </span>
      </div>

      {msg && !selected ? <p className="muted fade-in-soft">{msg}</p> : null}

      {loading ? (
        <TaskListSkeleton />
      ) : tasks.length === 0 ? (
        <div className="card text-center fade-in-soft">
          <p className="empty-state__title mb-2">Нет заданий</p>
          <p className="muted m-0">
            Для платформы в шапке сейчас нет доступных заданий.
          </p>
        </div>
      ) : (
        <div className="stack task-stack task-stack-grid">
          {tasks.map((t) => {
            const done = t.userStatus === "completed";
            return (
            <button
              key={t.id}
              type="button"
              className={`task-card task-card--interactive fade-in-soft ${t.validationType === "api" ? "task-card--border" : ""} ${done ? "task-card--done" : ""}`}
              onClick={() => {
                setModalMsg(null);
                setSelected(t);
              }}
            >
              <div className="task-card__top">
                <div className="task-card__tags">
                  <span className={platformPillClass(t.platform)}>
                    {platformLabel(t.platform)}
                  </span>
                  <span className="pill">
                    {t.type === "daily" ? "Ежедневно" : "Разово"}
                  </span>
                  {t.validationType === "api" ? (
                    <span className="pill pill--accent">API</span>
                  ) : null}
                  {done ? (
                    <span className="pill pill--accent">Выполнено</span>
                  ) : null}
                </div>
                <div className="task-card__reward">
                  <Coins size={18} strokeWidth={2.2} aria-hidden />
                  {t.reward.toLocaleString("ru-RU")}
                </div>
              </div>
              <p className="task-card__title">{t.title}</p>
              <p className="task-card__desc task-card__desc--compact">{t.description}</p>
              {t.lastError ? (
                <p className="err task-card__err">{t.lastError}</p>
              ) : null}
              <div className="task-card__row-open">
                <span>Подробнее</span>
                <ChevronRight size={18} className="muted" aria-hidden />
              </div>
            </button>
            );
          })}
        </div>
      )}

      <TaskDetailModal
        task={selected}
        open={selected != null}
        onClose={() => {
          setSelected(null);
          setModalMsg(null);
        }}
        claiming={claiming}
        statusMessage={modalMsg}
        onClaim={() => {
          if (selected) void claim(selected.id);
        }}
      />
    </div>
  );
}
