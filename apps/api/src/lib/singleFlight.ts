/**
 * Дедупликация параллельных вызовов с одним ключом (один процесс Node).
 * Снимает cache stampede: при промахе N запросов ждут одно вычисление.
 */
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => {
    inflight.delete(key);
  }) as Promise<T>;
  inflight.set(key, p);
  return p;
}
