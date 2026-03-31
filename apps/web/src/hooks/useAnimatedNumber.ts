import { useEffect, useRef, useState } from "react";

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

/**
 * Плавная «докрутка» числа при смене значения (баланс, награды).
 */
export function useAnimatedNumber(
  value: number | null,
  options?: { durationMs?: number }
): number | null {
  const [display, setDisplay] = useState<number | null>(() => value);
  const fromRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const skipNextAnim = useRef(true);

  useEffect(() => {
    if (value == null) {
      setDisplay(null);
      fromRef.current = null;
      skipNextAnim.current = true;
      return;
    }
    if (skipNextAnim.current) {
      skipNextAnim.current = false;
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current ?? value;
    if (from === value) return;

    const diff = Math.abs(value - from);
    const duration =
      options?.durationMs ??
      Math.min(1200, Math.max(450, 400 + Math.min(diff, 5000) * 0.12));

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeOutCubic(t);
      const cur = Math.round(from + (value - from) * e);
      setDisplay(cur);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, options?.durationMs]);

  return display;
}
