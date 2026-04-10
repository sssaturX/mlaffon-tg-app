import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { usePageTransition } from "../hooks/usePageTransition";

const DURATION_S = 0.2;
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type Props = {
  /** Обычно `location.pathname` — отдельный ключ от hash-поиска при необходимости. */
  routeKey: string;
  children: ReactNode;
};

/**
 * Анимация только области страницы (внутри layout с шапкой и табами).
 * GPU: opacity + translateY; при prefers-reduced-motion — без движения и почти без длительности.
 */
export function RouteTransition({ routeKey, children }: Props) {
  const reduceMotion = useReducedMotion();
  usePageTransition(routeKey);

  const y = reduceMotion ? 0 : 10;
  const duration = reduceMotion ? 0.01 : DURATION_S;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        className="app-route-transition"
        initial={{ opacity: 0, y }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
        transition={{ duration, ease: EASE }}
        style={{ willChange: reduceMotion ? undefined : "opacity, transform" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
