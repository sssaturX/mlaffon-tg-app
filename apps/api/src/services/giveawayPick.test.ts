import { describe, expect, it } from "vitest";
import {
  pickPredeterminedThenRandom,
  pickRandomFromParticipants,
} from "./giveawayPick.js";

describe("giveawayPick", () => {
  it("pickPredeterminedThenRandom: порядок пресета и только участники", () => {
    const parts = ["a", "b", "c", "d"];
    const out = pickPredeterminedThenRandom(parts, 2, ["c", "a", "ghost"]);
    expect(out).toEqual(["c", "a"]);
  });

  it("pickPredeterminedThenRandom: добор из оставшихся участников", () => {
    const parts = ["a", "b", "c"];
    const out = pickPredeterminedThenRandom(parts, 2, ["z"]);
    expect(out).toHaveLength(2);
    expect(new Set(out).size).toBe(2);
    for (const id of out) {
      expect(parts).toContain(id);
    }
  });

  it("pickPredeterminedThenRandom: ограничение pickCount", () => {
    const parts = ["a", "b"];
    expect(pickPredeterminedThenRandom(parts, 1, ["a", "b"])).toEqual(["a"]);
  });

  it("pickPredeterminedThenRandom: пустой пресет = как случайный пул", () => {
    const parts = ["x", "y"];
    const out = pickPredeterminedThenRandom(parts, 2, null);
    expect(out.sort()).toEqual(["x", "y"]);
  });

  it("pickRandomFromParticipants: уникальные и из пула", () => {
    const parts = ["p", "q", "r"];
    const out = pickRandomFromParticipants(parts, 2);
    expect(out).toHaveLength(2);
    expect(new Set(out).size).toBe(2);
    for (const id of out) expect(parts).toContain(id);
  });
});
