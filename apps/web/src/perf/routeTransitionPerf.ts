/**
 * DEV-only: user activation → route content mount (use Performance → User timings).
 * Не логирует в production.
 */
const DEV = import.meta.env.DEV;

let chainId = 0;
let pendingStartMark: string | null = null;
let pendingPath: string | null = null;

function normalizePath(p: string): string {
  return (p.split("?")[0] || "/").trim() || "/";
}

let lastActivationPath: string | null = null;
let lastActivationAt = 0;
const ACTIVATION_DEDUPE_MS = 90;

/** pointerdown / touchstart / click по ссылке (не hover-only). */
export function markUserNavActivation(pathname: string): void {
  if (!DEV || typeof performance.mark !== "function") return;
  const p = normalizePath(pathname);
  const now = performance.now();
  if (
    lastActivationPath === p &&
    now - lastActivationAt < ACTIVATION_DEDUPE_MS
  ) {
    return;
  }
  lastActivationPath = p;
  lastActivationAt = now;

  chainId += 1;
  pendingStartMark = `mlaffon-nav-${chainId}-start`;
  pendingPath = p;
  try {
    performance.mark(pendingStartMark);
  } catch {
    pendingStartMark = null;
    pendingPath = null;
  }
}

/** useLayoutEffect после смены routeKey в RouteTransition. */
export function markRouteContentMounted(pathname: string): void {
  if (!DEV || typeof performance.mark !== "function") return;
  const p = normalizePath(pathname);
  if (!pendingStartMark || pendingPath !== p) {
    pendingStartMark = null;
    pendingPath = null;
    return;
  }
  const endName = `mlaffon-nav-${chainId}-end`;
  try {
    performance.mark(endName);
    if (typeof performance.measure === "function") {
      performance.measure(`mlaffon: nav→mount ${p}`, pendingStartMark, endName);
    }
  } catch {
    /* ignore */
  }
  pendingStartMark = null;
  pendingPath = null;
}
