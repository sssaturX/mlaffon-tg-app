import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Platform, TaskDto } from "shared";
import { queryKeys } from "../../query/queryKeys";
import { fetchTasks } from "../../query/fetchers";

const STALE_TASKS = 1000 * 60 * 5;

/** Polling пока ждём модерацию скринов или API-проверку — без ручного «обнови». */
const TASKS_AWAITING_ADMIN_MS = 12_000;

export function platformQueryParamTasks(p: Platform): string {
  if (p === "twitch" || p === "kick") return p;
  return "all";
}

function tasksNeedModerationPoll(list: TaskDto[] | undefined): boolean {
  if (!list?.length) return false;
  return list.some(
    (t) =>
      (t.requiresEvidence === true && t.evidenceStageStatus === "submitted") ||
      (t.validationType === "api" && t.userStatus === "pending")
  );
}

/** SEMI_STATIC: задания с прогрессом пользователя. */
export function useTasks(activePlatform: Platform) {
  const platform = platformQueryParamTasks(activePlatform);
  return useQuery({
    queryKey: queryKeys.tasks.list(platform),
    queryFn: () => fetchTasks(platform),
    staleTime: STALE_TASKS,
    refetchInterval: (q) =>
      tasksNeedModerationPoll(q.state.data) ? TASKS_AWAITING_ADMIN_MS : false,
  });
}

let tasksInvalidateTimer: ReturnType<typeof setTimeout> | null = null;

/** Инвалидация с дебаунсом — claim + hover prefetch не дёргают два GET подряд. */
export function useInvalidateTasks(platform: Platform) {
  const qc = useQueryClient();
  const key = platformQueryParamTasks(platform);
  return () => {
    if (tasksInvalidateTimer) clearTimeout(tasksInvalidateTimer);
    tasksInvalidateTimer = setTimeout(() => {
      tasksInvalidateTimer = null;
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.list(key) });
    }, 400);
  };
}
