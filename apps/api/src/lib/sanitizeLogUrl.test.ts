import { describe, expect, it } from "vitest";
import { sanitizeRequestUrlForLog } from "./sanitizeLogUrl.js";

describe("sanitizeRequestUrlForLog", () => {
  it("redacts WebSocket query", () => {
    expect(sanitizeRequestUrlForLog("/api/v1/ws?ticket=secret")).toBe(
      "/api/v1/ws?<redacted>"
    );
    expect(sanitizeRequestUrlForLog("/api/v1/ws?token=legacy")).toBe(
      "/api/v1/ws?<redacted>"
    );
  });

  it("leaves other paths unchanged", () => {
    expect(sanitizeRequestUrlForLog("/api/v1/me")).toBe("/api/v1/me");
    expect(sanitizeRequestUrlForLog("/health")).toBe("/health");
  });
});
