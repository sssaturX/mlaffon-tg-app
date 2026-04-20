import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLayoutEffect, type ReactNode } from "react";
import { usePageTransition } from "../hooks/usePageTransition";
import { markRouteContentMounted } from "../perf/routeTransitionPerf";

/** Короче exit — меньше визуального «висения» при popLayout. */
const DURATION_S = 0.14;
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type Props = {
  /** Обычно `location.pathname` — отдельный ключ от hash-поиска при необходимости. */
  routeKey: string;
  children: ReactNode;
};

/**
 * Анимация только области страницы (внутри layout с шапкой и табами).
 * GPU: opacity + translateY; при prefers-reduced-motion — без движения и почти без длительности.
 *
 * `mode="popLayout"`: уходящая страница выводится из потока — **следующая может смонтироваться
 * сразу** (раньше, чем при `wait`, где exit полностью блокировал вход). Меньше задержка до
 * lazy-chunk + useQuery. Сравнение с `wait`: см. docs/route-transition-latency.md.
 *
 * willChange убран: постоянный GPU-слой ломает subpixel-антиалиасинг и делает шрифты мыльными.
 */
export function RouteTransition({ routeKey, children }: Props) {
  const reduceMotion = useReducedMotion();
  usePageTransition(routeKey);

  useLayoutEffect(() => {
    markRouteContentMounted(routeKey);
  }, [routeKey]);

  const y = reduceMotion ? 0 : 10;
  const duration = reduceMotion ? 0.01 : DURATION_S;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={routeKey}
        className="app-route-transition"
        initial={{ opacity: 0, y }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
        transition={{ duration, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
