import { describe, expect, it } from "vitest";
import { computeLevel, computeRewardMultiplier } from "./config.js";

describe("computeLevel", () => {
  it("zero lifetime", () => {
    expect(computeLevel(0)).toBe(0);
  });

  it("scales with sqrt and coinsPerLevelUnit", () => {
    expect(computeLevel(100)).toBe(1);
    expect(computeLevel(400)).toBe(2);
  });
});

describe("computeRewardMultiplier", () => {
  it("level 0 is 1", () => {
    expect(computeRewardMultiplier(0)).toBe(1);
  });

  it("follows rewardMultiplierPerLevel (0 in default config)", () => {
    expect(computeRewardMultiplier(2)).toBe(1);
  });
});
