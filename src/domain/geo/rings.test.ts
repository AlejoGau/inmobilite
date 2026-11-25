import { describe, expect, it } from "vitest";
import { stitchRings } from "./rings";

const key = (p: string): string => p;

describe("stitchRings", () => {
  it("joins open paths end to end, reversing them where needed", () => {
    expect(stitchRings([["a", "b", "c"], ["d", "c"], ["d", "a"]], key)).toEqual([
      { points: ["a", "b", "c", "d", "a"], parts: [0, 1, 2] },
    ]);
  });

  it("keeps a path that is already closed as its own ring", () => {
    expect(stitchRings([["a", "b", "c", "a"], ["x", "y"], ["y", "z", "x"]], key)).toEqual([
      { points: ["a", "b", "c", "a"], parts: [0] },
      { points: ["x", "y", "z", "x"], parts: [1, 2] },
    ]);
  });

  it("drops a chain that never closes", () => {
    expect(stitchRings([["a", "b", "c"], ["d", "a"]], key)).toEqual([]);
  });

  it("ignores paths too short to bound anything", () => {
    expect(stitchRings([["a"], ["a", "b", "a"], []], key)).toEqual([]);
  });

  it("does not splice a closed ring into a chain that touches it", () => {
    expect(stitchRings([["a", "b"], ["b", "x", "y", "b"], ["b", "c", "a"]], key)).toEqual([
      { points: ["a", "b", "c", "a"], parts: [0, 2] },
      { points: ["b", "x", "y", "b"], parts: [1] },
    ]);
  });
});
