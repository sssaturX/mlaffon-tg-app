import type { FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Монотонные метки времени от старта запроса (мс). */
    _traceT0?: number;
    _traceMarks?: Record<string, number>;
  }
}

export function initRequestTrace(req: FastifyRequest): void {
  const path = String(req.url ?? "").split("?")[0] ?? "";
  if (!path.startsWith("/api")) return;
  req._traceT0 = performance.now();
  req._traceMarks = {};
}

export function markRequestTrace(req: FastifyRequest, name: string): void {
  if (req._traceT0 == null || !req._traceMarks) return;
  req._traceMarks[name] = Math.round(performance.now() - req._traceT0);
}

/** Сводка для логов: метки + полное время ответа (мс). */
export function buildRequestTracePayload(
  req: FastifyRequest,
  responseElapsedMs: number
): Record<string, unknown> | undefined {
  if (req._traceT0 == null || !req._traceMarks) return undefined;
  const marks: Record<string, number> = {
    ...req._traceMarks,
    response_sent: Math.round(responseElapsedMs),
  };
  const authEnd =
    marks["auth_complete"] ?? marks["auth_skip_no_bearer"];
  const handlerApprox =
    authEnd != null
      ? Math.max(0, Math.round(responseElapsedMs) - authEnd)
      : undefined;
  return {
    requestTraceMs: marks,
    ...(handlerApprox != null ? { handlerApproxMs: handlerApprox } : {}),
  };
}

export function shouldEmitRequestTrace(
  responseElapsedMs: number,
  sampleRoll: number
): boolean {
  const minMs = Number.parseInt(process.env.API_TRACE_MIN_MS ?? "2000", 10);
  if (Number.isFinite(minMs) && minMs > 0 && responseElapsedMs >= minMs) return true;
  const rate = Number.parseFloat(process.env.API_TRACE_SAMPLE_RATE ?? "0");
  if (Number.isFinite(rate) && rate > 0 && sampleRoll < rate) return true;
  return false;
}
