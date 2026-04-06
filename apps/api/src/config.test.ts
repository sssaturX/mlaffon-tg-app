import { describe, expect, it } from "vitest";
import { computeLevel, computeRewardMultiplier } from "./config.js";

describe("computeLevel", () => {
  it("rank 1 at zero lifetime", () => {
    expect(computeLevel(0)).toBe(1);
  });

  it("uses customer rank table thresholds", () => {
    expect(computeLevel(100)).toBe(1);
    expect(computeLevel(300)).toBe(2);
    expect(computeLevel(3_700_000)).toBe(40);
  });
});

describe("computeRewardMultiplier", () => {
  it("rank 1 is 1", () => {
    expect(computeRewardMultiplier(1)).toBe(1);
  });

  it("increases with rank", () => {
    expect(computeRewardMultiplier(3)).toBeGreaterThan(computeRewardMultiplier(1));
  });
});
