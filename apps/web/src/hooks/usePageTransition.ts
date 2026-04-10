import { useLayoutEffect } from "react";

/**
 * Сброс скролла при смене маршрута — до отрисовки кадра, без «прыжка» после входа.
 */
export function usePageTransition(routeKey: string): void {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [routeKey]);
}
