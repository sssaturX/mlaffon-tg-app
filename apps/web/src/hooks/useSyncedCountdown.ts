import { useEffect, useState } from "react";

/**
 * Обратный отсчёт до `endsAt` с поправкой по `serverNow` (снимает дрейф клиента).
 * Обновление через rAF (~плавно, без скачков раз в секунду).
 */
export function useSyncedCountdownMs(
  endsAtIso: string | null,
  serverNowIso: string | null,
  active: boolean
): number {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    if (!active || !endsAtIso || !serverNowIso) {
      setMs(0);
      return;
    }
    const end = Date.parse(endsAtIso);
    const offset = Date.parse(serverNowIso) - Date.now();
    let raf = 0;

    const tick = () => {
      const left = Math.max(0, end - (Date.now() + offset));
      setMs(left);
      if (left > 0) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [endsAtIso, serverNowIso, active]);

  return ms;
}
