import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Coins, HelpCircle, Lightbulb } from "lucide-react";
import type { Platform, TaskDto } from "shared";
import { api, formatApiError } from "../api";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { useActivePlatform } from "../context/PlatformContext";
import { HelpSheetModal } from "../components/HelpSheetModal";
import { TaskDetailModal } from "../components/TaskDetailModal";
import { useInvalidateTasks, useTasks } from "../hooks/queries/useTasks";
import { ApiQueryError } from "../query/apiQueryError";
import { appEventBus } from "../events/appEventBus";

const SECTION_ORDER = [
  "black_russia",
  "stream_tasks",
  "telegram",
  "global",
  "other",
] as const;

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

function sectionHeading(section: string, activePlatform: Platform): string {
  if (section === "black_russia") return "BLACK RUSSIA";
  if (section === "stream_tasks")
    return activePlatform === "kick" ? "KICK" : "TWITCH";
  if (section === "telegram") return "TELEGRAM";
  if (section === "global") return "ОБЩЕЕ";
  return "ЗАДАНИЯ";
}

function defaultActionLabel(platform: Platform): string {
  if (platform === "kick") return "Подписаться на Kick";
  if (platform === "twitch") return "Подписаться на Twitch";
  if (platform === "telegram") return "Подписаться в Telegram";
  return "Перейти";
}

/** В TWA часто пустой `type`; iPhone — HEIC. */
function fileLooksLikeEvidenceImage(f: File): boolean {
  if (f.type && /^image\//i.test(f.type)) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(f.name);
}

function streamPreviewThemeClass(
  section: string,
  activePlatform: Platform
): string {
  if (section !== "stream_tasks") return "";
  return activePlatform === "kick"
    ? "task-card-preview--kick-stream"
    : "task-card-preview--twitch-stream";
}

function sectionHeadingClass(section: string, activePlatform: Platform): string {
  if (section !== "stream_tasks") return "";
  return activePlatform === "kick"
    ? "task-stream__heading--kick"
    : "task-stream__heading--twitch";
}

function TaskListSkeleton() {
  return (
    <div className="task-list-skeleton" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="task-card-preview task-card-preview--skeleton">
          <div className="skeleton task-skeleton__line task-skeleton__line--short" />
          <div className="skeleton task-skeleton__line task-skeleton__line--medium" />
        </div>
      ))}
    </div>
  );
}

function taskKindPill(t: TaskDto): { label: string; variant: "sub" | "project" | "neutral" } {
  if (t.requiresEvidence) return { label: "Проект", variant: "project" };
  if (t.validationType === "api") return { label: "Подписка", variant: "sub" };
  return { label: "Задание", variant: "neutral" };
}

export default function Tasks() {
  const { patchMe, syncMeFromNetwork, reconcileFromServer } =
    useMeEconomySync();
  const { activePlatform } = useActivePlatform();
  const invalidateTasks = useInvalidateTasks(activePlatform);
  const tasksQ = useTasks(activePlatform);
  const tasks = tasksQ.data ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [evidenceByTask, setEvidenceByTask] = useState<Record<string, FileList | null>>({});
  const [evidenceUploadingId, setEvidenceUploadingId] = useState<string | null>(null);
  const [helpTask, setHelpTask] = useState<TaskDto | null>(null);
  const [detailTask, setDetailTask] = useState<TaskDto | null>(null);

  const loading = tasksQ.isPending;

  useEffect(() => {
    if (tasksQ.isError) {
      const e = tasksQ.error;
      setMsg(
        e instanceof ApiQueryError ? formatApiError(e.apiErr) : "Ошибка загрузки"
      );
    } else if (tasksQ.isSuccess) setMsg(null);
  }, [tasksQ.isError, tasksQ.isSuccess, tasksQ.error]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaskDto[]>();
    for (const t of tasks) {
      const key = t.uiSection?.trim() || "other";
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [tasks]);

  const sectionKeys = useMemo(() => {
    const order = [...SECTION_ORDER] as string[];
    const keys: string[] = [];
    for (const k of SECTION_ORDER) {
      if (grouped.get(k)?.length) keys.push(k);
    }
    for (const k of grouped.keys()) {
      if (!order.includes(k) && grouped.get(k)?.length) keys.push(k);
    }
    return keys;
  }, [grouped]);

  async function claim(id: string) {
    setMsg(null);
    setClaimingId(id);
    const r = await api<{
      reward?: number;
      coins?: number;
      coinsTwitch?: number;
      coinsKick?: number;
      status?: string;
      jobId?: string;
    }>(`/api/v1/tasks/${id}/claim`, { method: "POST" });
    setClaimingId(null);
    if (r.ok) {
      if (r.data.status === "pending") {
        const m =
          "Задание в очереди на проверку. Обновите через несколько секунд.";
        setMsg(m);
        invalidateTasks();
        appEventBus.emit("me:reconcile:economy", { delayMs: 0 });
        return;
      }
      const okMsg = `+${r.data.reward ?? 0} монет`;
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
      setMsg(formatApiError(r));
    }
  }

  const uploadEvidence = useCallback(
    async (task: TaskDto, images: string[]) => {
      setEvidenceUploadingId(task.id);
      const stage = Math.max(1, (task.hardStageCurrent ?? 0) + 1);
      const r = await api<{ ok: boolean }>(`/api/v1/tasks/${task.id}/evidence`, {
        method: "POST",
        body: JSON.stringify({ stage, images }),
      });
      setEvidenceUploadingId(null);
      if (r.ok) {
        setMsg("Скрины загружены. Дождитесь проверки админом.");
        setEvidenceByTask((prev) => ({ ...prev, [task.id]: null }));
        invalidateTasks();
        return;
      }
      setMsg(formatApiError(r));
    },
    [invalidateTasks]
  );

  async function submitEvidence(task: TaskDto) {
    const files = evidenceByTask[task.id];
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 4);
    const skipped: string[] = [];
    const encoded: string[] = [];
    for (const f of list) {
      if (!fileLooksLikeEvidenceImage(f)) {
        skipped.push(f.name || "файл");
        continue;
      }
      if (f.size > 2_500_000) {
        skipped.push(`${f.name || "файл"} (>2,5 МБ)`);
        continue;
      }
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("read_failed"));
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.readAsDataURL(f);
        });
        if (!/^data:image\//i.test(data)) {
          skipped.push(f.name || "файл");
          continue;
        }
        encoded.push(data);
      } catch {
        skipped.push(f.name || "файл");
      }
    }
    if (encoded.length === 0) {
      setMsg(
        skipped.length
          ? `Не удалось прочитать изображения: ${skipped.join(", ")}. Нужны JPG/PNG/WebP до 2,5 МБ (HEIC — сохрани как JPEG в галерее).`
          : "Выберите файлы изображений (JPG, PNG, WebP до 2,5 МБ)."
      );
      return;
    }
    await uploadEvidence(task, encoded);
  }

  function actionLabelForTask(t: TaskDto): string {
    if (t.userStatus === "completed") return "Выполнено";
    if (t.userStatus === "pending") return "Проверяем…";
    if (t.userStatus === "locked") return "Недоступно";
    if (t.requiresEvidence) {
      const st = t.evidenceStageStatus ?? "none";
      if (st === "submitted") return "На проверке у админа";
      if (st === "approved") return "Получить награду";
      if (st === "rejected") return "Скрины отклонены";
      return "Сначала загрузите скрины";
    }
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
    if (
      t.userStatus === "completed" ||
      t.userStatus === "pending" ||
      t.userStatus === "locked"
    ) {
      return true;
    }
    if (t.requiresEvidence && t.evidenceStageStatus !== "approved") {
      return true;
    }
    return false;
  }

  function renderTaskCard(t: TaskDto, section: string) {
    const done = t.userStatus === "completed";
    const streamTheme = streamPreviewThemeClass(section, activePlatform);
    const kind = taskKindPill(t);
    const kindClass =
      kind.variant === "sub"
        ? "pill pill--task-sub"
        : kind.variant === "project"
          ? "pill pill--task-project"
          : "pill";

    return (
      <article
        key={t.id}
        className={`task-card-preview fade-in-soft ${streamTheme} ${t.validationType === "api" ? "task-card-preview--accent" : ""} ${done ? "task-card-preview--done" : ""}`}
      >
        <button
          type="button"
          className={`task-card-preview__main ${t.help ? "task-card-preview__main--with-help" : ""}`}
          onClick={() => setDetailTask(t)}
        >
          <div className="task-card-preview__row">
            <div className="task-card-preview__tags">
              <span className={kindClass}>{kind.label}</span>
              <span className={platformPillClass(t.platform)}>
                {platformLabel(t.platform)}
              </span>
              <span className="pill pill--compact">
                {t.type === "daily" ? "Ежедневно" : "Разово"}
              </span>
              {t.validationType === "api" ? (
                <span className="pill pill--accent pill--compact">С проверкой</span>
              ) : null}
              {done ? (
                <span className="pill pill--accent pill--compact">Готово</span>
              ) : null}
            </div>
            <div className="task-card-preview__reward">
              <Coins size={18} strokeWidth={2.2} aria-hidden />
              <span>{t.reward.toLocaleString("ru-RU")}</span>
            </div>
          </div>
          <h3 className="task-card-preview__title">{t.title}</h3>
          <p className="task-card-preview__snippet">{t.description}</p>
          <div className="task-card-preview__footer">
            <span className="task-card-preview__hint muted">Подробности и действия</span>
            <ChevronRight className="task-card-preview__arrow" size={20} strokeWidth={2} aria-hidden />
          </div>
        </button>
        {t.help ? (
          <button
            type="button"
            className="task-card-preview__help"
            aria-label="Справка по заданию"
            onClick={() => setHelpTask(t)}
          >
            <HelpCircle size={18} strokeWidth={2.2} />
          </button>
        ) : null}
      </article>
    );
  }

  return (
    <div>
      <div className="task-hint task-hint--stream" role="note">
        <Lightbulb size={20} className="task-hint__icon" aria-hidden />
        <span>
          Больше заданий появляется, когда идёт стрим. Нажми карточку — снизу
          откроется окно с полным текстом, наградой и кнопками.
        </span>
      </div>

      {msg && !detailTask ? (
        <p className="muted fade-in-soft task-page-msg">{msg}</p>
      ) : null}

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
        <div className="task-stream">
          {sectionKeys.map((section) => (
            <section key={section} className="task-stream__section">
              <h2
                className={`task-stream__heading ${sectionHeadingClass(section, activePlatform)}`}
              >
                {sectionHeading(section, activePlatform)}
              </h2>
              <div className="stack task-stack">
                {(grouped.get(section) ?? []).map((t) =>
                  renderTaskCard(t, section)
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {helpTask?.help ? (
        <HelpSheetModal
          open={helpTask != null}
          title={helpTask.help.title}
          body={helpTask.help.body}
          icon={helpTask.help.icon}
          onClose={() => setHelpTask(null)}
        />
      ) : null}

      <TaskDetailModal
        task={detailTask}
        open={detailTask != null}
        onClose={() => setDetailTask(null)}
        onClaim={() => {
          if (detailTask) void claim(detailTask.id);
        }}
        claiming={detailTask != null && claimingId === detailTask.id}
        primaryLabel={
          detailTask
            ? claimingId === detailTask.id
              ? "…"
              : actionLabelForTask(detailTask)
            : ""
        }
        primaryDisabled={detailTask ? actionDisabled(detailTask) : true}
        statusMessage={msg}
        evidenceFiles={detailTask ? evidenceByTask[detailTask.id] ?? null : null}
        onEvidenceFilesChange={(files) => {
          if (!detailTask) return;
          setEvidenceByTask((prev) => ({ ...prev, [detailTask.id]: files }));
        }}
        onSubmitEvidence={async () => {
          if (detailTask) await submitEvidence(detailTask);
        }}
        evidenceUploading={detailTask != null && evidenceUploadingId === detailTask.id}
      />
    </div>
  );
}
