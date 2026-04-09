/** Простой типизированный шина событий (синхронная доставка подписчикам). */

export type Unsubscribe = () => void;

export function createEventBus<TEvents extends Record<string, unknown>>() {
  const listeners = new Map<
    keyof TEvents,
    Set<(payload: TEvents[keyof TEvents]) => void>
  >();

  function emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = listeners.get(event);
    if (!set?.size) return;
    for (const fn of set) {
      fn(payload as TEvents[keyof TEvents]);
    }
  }

  function subscribe<K extends keyof TEvents>(
    event: K,
    handler: (payload: TEvents[K]) => void
  ): Unsubscribe {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler as (payload: TEvents[keyof TEvents]) => void);
    return () => {
      set!.delete(handler as (payload: TEvents[keyof TEvents]) => void);
    };
  }

  function once<K extends keyof TEvents>(
    event: K,
    handler: (payload: TEvents[K]) => void
  ): Unsubscribe {
    const off = subscribe(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  return { emit, subscribe, once };
}
