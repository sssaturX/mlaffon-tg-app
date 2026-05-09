import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import type { TaskDto } from "shared";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";
import { HelpSheetModal } from "../components/HelpSheetModal";
import { TaskDetailModal } from "../components/TaskDetailModal";
import { useRefetchTasks, useTasks } from "../hooks/queries/useTasks";
import {
  markTaskEvidenceSubmitted,
  replaceTasksListFromClaim,
} from "../query/tasksCache";
import { ApiQueryError } from "../query/apiQueryError";
import { TaskVirtualFeed } from "../components/tasks/TaskVirtualFeed";
import { queryKeys } from "../query/queryKeys";
import { liveBroadcastWsOnlyQueryFn } from "../realtime/wsOnlyQueryFns";
import { openExternal } from "../components/LiveBroadcastCard";

const SECTION_ORDER = [
  "live_stream_tasks",
  "black_russia",
  "stream_tasks",
  "telegram",
  "global",
  "other",
] as const;

/** В TWA часто пустой `type`; iPhone — HEIC. */
function fileLooksLikeEvidenceImage(f: File): boolean {
  if (f.type && /^image\//i.test(f.type)) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(f.name);
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

export default function Tasks() {
  const { activePlatform } = useActivePlatform();
  const { showToast } = useToast();
  const refetchTasks = useRefetchTasks(activePlatform);
  const tasksQ = useTasks(activePlatform);
  const tasks = tasksQ.data ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const loadErrorToastKey = useRef<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [evidenceByTask, setEvidenceByTask] = useState<Record<string, FileList | null>>({});
  const [evidenceUploadingId, setEvidenceUploadingId] = useState<string | null>(null);
  const [helpTask, setHelpTask] = useState<TaskDto | null>(null);
  const [detailTask, setDetailTask] = useState<TaskDto | null>(null);
  const [streamMessageByTask, setStreamMessageByTask] = useState<Record<string, string>>({});
  const { data: live } = useQuery({
    queryKey: queryKeys.liveBroadcast.current(),
    queryFn: liveBroadcastWsOnlyQueryFn,
    staleTime: Infinity,
    enabled: false,
  });

  const loading = tasksQ.isPending;

  const onOpenDetail = useCallback((t: TaskDto) => setDetailTask(t), []);
  const onOpenHelp = useCallback((t: TaskDto) => setHelpTask(t), []);

  useEffect(() => {
    if (tasksQ.isError) {
      const e = tasksQ.error;
      const text =
        e instanceof ApiQueryError
          ? formatApiError(e.apiErr)
          : "Не удалось загрузить задания. Проверьте сеть и попробуйте снова.";
      setMsg(text);
      const key = `${activePlatform}:${text}`;
      if (loadErrorToastKey.current !== key) {
        loadErrorToastKey.current = key;
        showToast(text, "error");
      }
    } else if (tasksQ.isSuccess) {
      loadErrorToastKey.current = null;
      setMsg(null);
    }
  }, [
    activePlatform,
    showToast,
    tasksQ.isError,
    tasksQ.isSuccess,
    tasksQ.error,
  ]);

  useEffect(() => {
    setDetailTask((prev) => {
      if (!prev) return prev;
      const next = tasks.find((x) => x.id === prev.id);
      return next ?? prev;
    });
    setHelpTask((prev) => {
      if (!prev) return prev;
      const next = tasks.find((x) => x.id === prev.id);
      if (!next?.help) return null;
      return next;
    });
  }, [tasks]);

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

  function liveAction(t: TaskDto): string | null {
    const action = t.meta?.liveAction;
    return typeof action === "string" ? action : null;
  }

  function progressReached(t: TaskDto): boolean {
    return (
      typeof t.progressCurrent === "number" &&
      typeof t.progressTarget === "number" &&
      t.progressTarget > 0 &&
      t.progressCurrent >= t.progressTarget
    );
  }

  async function runLivePrerequisite(t: TaskDto): Promise<boolean> {
    if (progressReached(t)) return true;
    const action = liveAction(t);
    if (!action) return true;

    if (!live?.active || live.platform !== t.platform) {
      const m = "Это задание доступно только во время активного стрима.";
      setMsg(m);
      showToast(m, "error");
      return false;
    }

    if (action === "watch_stream") {
      openExternal(live.streamUrl);
      const r = await api<{
        ok: boolean;
        streak: number;
        bonusCoinsAwarded: number;
      }>("/api/v1/live-broadcast/watch", {
        method: "POST",
        body: JSON.stringify({ broadcastId: live.id }),
      });
      if (!r.ok) {
        const m = formatApiError(r);
        setMsg(m);
        showToast(m, "error");
        return false;
      }
      const bonus = r.data.bonusCoinsAwarded ?? 0;
      showToast(
        bonus > 0
          ? `Стрим засчитан. Бонус за стрик: +${bonus.toLocaleString("ru-RU")} монет`
          : "Стрим засчитан.",
        "success"
      );
      return true;
    }

    if (action === "stream_message") {
      const text = (streamMessageByTask[t.id] ?? "").trim();
      if (text.length < 2) {
        const m = "Введите текст сообщения из чата.";
        setMsg(m);
        showToast(m, "error");
        return false;
      }
      const r = await api<{ accepted: true; totalForPlatform: number }>(
        "/api/v1/tasks/stream-message",
        {
          method: "POST",
          body: JSON.stringify({ platform: t.platform, text }),
        }
      );
      if (!r.ok) {
        const m = formatApiError(r);
        setMsg(m);
        showToast(m, "error");
        return false;
      }
      showToast("Сообщение зачтено.", "success");
      return true;
    }

    return true;
  }

  async function claim(t: TaskDto) {
    const id = t.id;
    setMsg(null);
    setClaimingId(id);
    try {
      const prereqOk = await runLivePrerequisite(t);
      if (!prereqOk) return;

      const r = await api<{
        ok?: boolean;
        reward?: number;
        status?: string;
        jobId?: string;
        tasks?: TaskDto[];
      }>(
        `/api/v1/tasks/${id}/claim?platform=${encodeURIComponent(activePlatform)}`,
        { method: "POST" }
      );
    if (r.ok) {
      if (r.data.status === "pending") {
        setMsg(null);
        showToast("Задание отправлено на проверку подписки.", "info");
        setDetailTask((prev) =>
          prev?.id === id ? { ...prev, userStatus: "pending", lastError: null } : prev
        );
        void refetchTasks();
        return;
      }
      const reward = r.data.reward ?? 0;
      setMsg(null);
      showToast(
        reward > 0
          ? `Задание выполнено! +${reward.toLocaleString("ru-RU")} монет`
          : "Задание выполнено!",
        "success"
      );
      if (Array.isArray(r.data.tasks)) {
        replaceTasksListFromClaim(activePlatform, r.data.tasks);
        const fresh = r.data.tasks.find((t) => t.id === id);
        if (fresh) {
          setDetailTask((prev) => (prev?.id === id ? fresh : prev));
        }
      } else {
        void refetchTasks();
      }
    } else {
      const m = formatApiError(r);
      setMsg(m);
      showToast(m, "error");
    }
    } finally {
      setClaimingId(null);
    }
  }

  const uploadEvidence = useCallback(
    async (task: TaskDto, images: string[]) => {
      setEvidenceUploadingId(task.id);
      const stage =
        typeof task.chainOrder === "number" && task.chainOrder >= 1
          ? task.chainOrder
          : Math.max(1, (task.hardStageCurrent ?? 0) + 1);
      const r = await api<{ ok: boolean }>(`/api/v1/tasks/${task.id}/evidence`, {
        method: "POST",
        body: JSON.stringify({ stage, images }),
      });
      setEvidenceUploadingId(null);
      if (r.ok) {
        setMsg(null);
        showToast("Скрины отправлены на проверку администратору.", "success");
        setEvidenceByTask((prev) => ({ ...prev, [task.id]: null }));
        markTaskEvidenceSubmitted(activePlatform, task.id);
        setDetailTask((prev) =>
          prev?.id === task.id
            ? {
                ...prev,
                evidenceStageStatus: "submitted",
                evidenceAdminNote: null,
              }
            : prev
        );
        void refetchTasks();
        return;
      }
      const m = formatApiError(r);
      setMsg(m);
      showToast(m, "error");
    },
    [activePlatform, refetchTasks, showToast]
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
      const m = skipped.length
        ? `Не удалось прочитать изображения: ${skipped.join(", ")}. Нужны JPG/PNG/WebP до 2,5 МБ (HEIC — сохрани как JPEG в галерее).`
        : "Выберите файлы изображений (JPG, PNG, WebP до 2,5 МБ).";
      setMsg(m);
      showToast(m, "error");
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
    if (liveAction(t) === "watch_stream") return "Зайти на стрим";
    if (liveAction(t) === "stream_message") return "Проверить сообщение";
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
    if (liveAction(t) === "stream_message" && !progressReached(t)) {
      return (streamMessageByTask[t.id] ?? "").trim().length < 2;
    }
    if (
      (liveAction(t) === "watch_stream" || liveAction(t) === "stream_message") &&
      !progressReached(t) &&
      (!live?.active || live.platform !== t.platform)
    ) {
      return true;
    }
    return false;
  }

  return (
    <div className="tasks-page">
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
        <TaskVirtualFeed
          sectionKeys={sectionKeys}
          grouped={grouped}
          activePlatform={activePlatform}
          onOpenDetail={onOpenDetail}
          onOpenHelp={onOpenHelp}
        />
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
          if (detailTask) void claim(detailTask);
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
        streamMessageText={detailTask ? streamMessageByTask[detailTask.id] ?? "" : ""}
        onStreamMessageTextChange={(value) => {
          if (!detailTask) return;
          setStreamMessageByTask((prev) => ({ ...prev, [detailTask.id]: value }));
        }}
      />
    </div>
  );
}
