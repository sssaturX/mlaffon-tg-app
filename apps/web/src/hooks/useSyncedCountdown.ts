import { useEffect, useState } from "react";

/**
 * Обратный отсчёт до `endsAt` с фиксированным смещением «сервер ↔ клиент».
 *
 * `clockOffsetMs` = `Date.parse(serverNow) - Date.now()` **в момент применения** снимка с WS,
 * одно на весь дроп — иначе при открытии оверлея позже offset пересчитывается «как будто
 * serverNow был только что», и таймер в попапе расходится с бегущей строкой.
 */
export function useSyncedCountdownMs(
  endsAtIso: string | null,
  clockOffsetMs: number | null,
  active: boolean
): number {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    if (!active || !endsAtIso || clockOffsetMs === null) {
      setMs(0);
      return;
    }
    const end = Date.parse(endsAtIso);
    if (!Number.isFinite(end)) {
      setMs(0);
      return;
    }
    let raf = 0;

    const tick = () => {
      const left = Math.max(0, end - (Date.now() + clockOffsetMs));
      setMs(left);
      if (left > 0) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [endsAtIso, clockOffsetMs, active]);

  return ms;
}
