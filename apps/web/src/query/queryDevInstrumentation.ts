import { queryClient } from "./queryClient";

/**
 * DEV: подписка на кэш — в консоль уходит старт fetch по ключу (дубли на одном жесте видны сразу).
 * В production не регистрируется.
 */
export function registerQueryDevInstrumentation(): void {
  if (!import.meta.env.DEV) return;

  const recent = new Map<string, number>();
  const DEDUPE_LOG_MS = 80;

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const q = event.query;
    if (q.state.fetchStatus !== "fetching") return;
    const keyStr = JSON.stringify(q.queryKey);
    const now = performance.now();
    const prev = recent.get(keyStr) ?? 0;
    if (now - prev < DEDUPE_LOG_MS) return;
    recent.set(keyStr, now);
    console.debug("[mlaffon rq fetch]", keyStr);
  });
}
