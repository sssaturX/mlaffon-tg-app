import type { Platform, TaskDto } from "shared";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";

function tasksListKey(p: Platform): string {
  if (p === "twitch" || p === "kick") return p;
  return "all";
}

/** Список после sync claim — без отдельного GET /tasks. */
export function replaceTasksListFromClaim(
  activePlatform: Platform,
  tasks: TaskDto[]
): void {
  const key = tasksListKey(activePlatform);
  queryClient.setQueryData<TaskDto[]>(queryKeys.tasks.list(key), tasks);
}

/** Локально помечаем скрины отправленными — без лишнего GET /tasks. */
export function markTaskEvidenceSubmitted(
  activePlatform: Platform,
  taskId: string
): void {
  const key = tasksListKey(activePlatform);
  queryClient.setQueryData<TaskDto[]>(queryKeys.tasks.list(key), (old) => {
    if (!old) return old;
    return old.map((t) =>
      t.id === taskId
        ? {
            ...t,
            evidenceStageStatus: "submitted" as const,
            evidenceAdminNote: null,
          }
        : t
    );
  });
}
