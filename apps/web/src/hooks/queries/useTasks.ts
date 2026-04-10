import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Platform, TaskDto } from "shared";
import { queryKeys } from "../../query/queryKeys";
import { fetchTasks } from "../../query/fetchers";

const STALE_TASKS = 1000 * 60 * 5;
const GC_TASKS = 1000 * 60 * 30;

/** Polling только при ожидании модерации / API — вкладка на переднем плане. */
const TASKS_AWAITING_ADMIN_MS = 15_000;

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

/** SEMI_STATIC: задания с прогрессом пользователя; без лишних GET при навигации. */
export function useTasks(activePlatform: Platform) {
  const platform = platformQueryParamTasks(activePlatform);
  return useQuery({
    queryKey: queryKeys.tasks.list(platform),
    queryFn: () => fetchTasks(platform),
    staleTime: STALE_TASKS,
    gcTime: GC_TASKS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (q) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return false;
      }
      return tasksNeedModerationPoll(q.state.data)
        ? TASKS_AWAITING_ADMIN_MS
        : false;
    },
  });
}

/** Один дедуплицированный fetch (например после async claim) — не invalidate. */
export function useRefetchTasks(platform: Platform) {
  const qc = useQueryClient();
  const key = platformQueryParamTasks(platform);
  return () =>
    void qc.fetchQuery({
      queryKey: queryKeys.tasks.list(key),
      queryFn: () => fetchTasks(key),
      staleTime: STALE_TASKS,
    });
}
