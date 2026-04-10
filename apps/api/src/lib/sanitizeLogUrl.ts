/** Strip sensitive query params from request URLs before logging. */
export function sanitizeRequestUrlForLog(url: string): string {
  if (!url) return url;
  const path = url.split("?")[0] ?? "";
  if (path === "/api/v1/ws") {
    return "/api/v1/ws?<redacted>";
  }
  return url;
}
