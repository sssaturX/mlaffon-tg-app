import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Platform } from "shared";
import { queryKeys } from "../../query/queryKeys";
import { fetchTasks } from "../../query/fetchers";

const STALE_TASKS = 1000 * 60 * 5;

function platformQueryParam(p: Platform): string {
  if (p === "twitch" || p === "kick") return p;
  return "all";
}

/** SEMI_STATIC: задания с прогрессом пользователя. */
export function useTasks(activePlatform: Platform) {
  const platform = platformQueryParam(activePlatform);
  return useQuery({
    queryKey: queryKeys.tasks.list(platform),
    queryFn: () => fetchTasks(platform),
    staleTime: STALE_TASKS,
  });
}

export function useInvalidateTasks(platform: Platform) {
  const qc = useQueryClient();
  const key = platformQueryParam(platform);
  return () =>
    void qc.invalidateQueries({ queryKey: queryKeys.tasks.list(key) });
}
