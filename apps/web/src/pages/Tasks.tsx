import { useEffect, useState } from "react";
import { ChevronRight, Coins, Lightbulb } from "lucide-react";
import type { TaskDto } from "shared";
import { api, formatApiError } from "../api";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { useActivePlatform } from "../context/PlatformContext";
import { TaskDetailModal } from "../components/TaskDetailModal";
import { useInvalidateTasks, useTasks } from "../hooks/queries/useTasks";
import { ApiQueryError } from "../query/apiQueryError";
import { appEventBus } from "../events/appEventBus";
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

export default function Tasks() {
  const { patchMe, syncMeFromNetwork, reconcileFromServer } =
    useMeEconomySync();
  const { activePlatform } = useActivePlatform();
  const invalidateTasks = useInvalidateTasks(activePlatform);
  const tasksQ = useTasks(activePlatform);
  const tasks = tasksQ.data ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<TaskDto | null>(null);
  const [modalMsg, setModalMsg] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [evidenceUploading, setEvidenceUploading] = useState(false);

  const loading = tasksQ.isPending;
  useEffect(() => {
    if (tasksQ.isError) {
      const e = tasksQ.error;
      setMsg(
        e instanceof ApiQueryError ? formatApiError(e.apiErr) : "Ошибка загрузки"
      );
    } else if (tasksQ.isSuccess) setMsg(null);
  }, [tasksQ.isError, tasksQ.isSuccess, tasksQ.error]);

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
      coinsTwitch?: number;
      coinsKick?: number;
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
        invalidateTasks();
        appEventBus.emit("me:reconcile:economy", { delayMs: 0 });
        return;
      }
      const okMsg = `+${r.data.reward ?? 0} монет`;
      setModalMsg(okMsg);
      setMsg(okMsg);
      invalidateTasks();
      if (
        typeof r.data.coins === "number" &&
        typeof r.data.coinsTwitch === "number" &&
        typeof r.data.coinsKick === "number"
      ) {
        patchMe(() => ({
          coins: r.data.coins,
          coinsTwitch: r.data.coinsTwitch,
          coinsKick: r.data.coinsKick,
        }));
        reconcileFromServer();
      } else {
        void syncMeFromNetwork();
      }
    } else {
      const err = formatApiError(r);
      setModalMsg(err);
      setMsg(err);
    }
  }

  async function uploadEvidence(task: TaskDto, images: string[]) {
    setModalMsg(null);
    setEvidenceUploading(true);
    const stage = Math.max(1, (task.hardStageCurrent ?? 0) + 1);
    const r = await api<{ ok: boolean }>(`/api/v1/tasks/${task.id}/evidence`, {
      method: "POST",
      body: JSON.stringify({ stage, images }),
    });
    setEvidenceUploading(false);
    if (r.ok) {
      setModalMsg("Скрины загружены. Дождитесь проверки админом.");
      invalidateTasks();
      return;
    }
    setModalMsg(formatApiError(r));
  }

  function actionLabelForTask(t: TaskDto): string {
    if (t.userStatus === "completed") return "Выполнено";
    if (t.userStatus === "pending") return "Проверяем…";
    if (t.userStatus === "locked") return "Недоступно";
    if (
      typeof t.progressTarget === "number" &&
      typeof t.progressCurrent === "number" &&
      t.progressCurrent >= t.progressTarget
    ) {
      return "Получить";
    }
    return t.verifyLabel ?? "Проверить";
  }

  function actionDisabled(t: TaskDto): boolean {
    return t.userStatus === "completed" || t.userStatus === "pending" || t.userStatus === "locked";
  }

  return (
    <div>
      <div className="task-hint" role="note">
        <Lightbulb size={20} className="task-hint__icon" aria-hidden />
        <span>Короткие задания. Главное — прогресс и кнопка действия.</span>
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
                    <span className="pill pill--accent">С проверкой</span>
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
              {t.hard ? (
                <p className="task-card__status task-card__status--hard">
                  HARD {Math.max(0, t.hardStageCurrent ?? 0)}/{Math.max(0, t.hardStageTotal ?? 2)}
                </p>
              ) : null}
              {typeof t.progressCurrent === "number" && typeof t.progressTarget === "number" ? (
                <div className="task-progress">
                  <div className="task-progress__head">
                    <span className="muted">{t.progressLabel ?? "Прогресс"}</span>
                    <span className="muted">
                      {t.progressCurrent}/{t.progressTarget}
                    </span>
                  </div>
                  <div className="task-progress__bar">
                    <div
                      className="task-progress__fill"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(100, (t.progressCurrent / Math.max(1, t.progressTarget)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {t.lastError ? (
                <p className="err task-card__err">{t.lastError}</p>
              ) : null}
              <button
                type="button"
                className="primary"
                disabled={claiming || actionDisabled(t)}
                onClick={(e) => {
                  e.stopPropagation();
                  void claim(t.id);
                }}
              >
                {actionLabelForTask(t)}
              </button>
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
        evidenceUploading={evidenceUploading}
        onUploadEvidence={
          selected?.hard
            ? async (images) => {
                await uploadEvidence(selected, images);
              }
            : undefined
        }
        onClaim={() => {
          if (selected) void claim(selected.id);
        }}
      />
    </div>
  );
}
