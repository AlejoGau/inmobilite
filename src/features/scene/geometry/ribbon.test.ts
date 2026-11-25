import { describe, expect, it } from "vitest";
import type { Vec2 } from "@/domain/types";
import { windingMatchesNormals } from "../testing/geometryChecks";
import { distance } from "./polygon2d";
import { buildRibbonGeometry, DEFAULT_MITER_LIMIT, dedupePolyline, offsetPolyline, ribbonOutline } from "./ribbon";

/** Distance from p to the infinite line through a and b. */
function distanceToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / Math.hypot(dx, dy);
}

describe("ribbon", () => {
  it("offsets a straight line by exactly the half width, left being +", () => {
    const left = offsetPolyline(
      [
        [0, 0],
        [10, 0],
      ],
      2,
    );
    expect(left).toEqual([
      [0, 2],
      [10, 2],
    ]);
  });

  it("mitres a right-angle corner so both sides stay at the half width from both segments", () => {
    const pts: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const { left, right } = ribbonOutline(pts, 3);
    for (const side of [left, right]) {
      const corner = side[1];
      expect(distanceToLine(corner, pts[0], pts[1])).toBeCloseTo(3, 9);
      expect(distanceToLine(corner, pts[1], pts[2])).toBeCloseTo(3, 9);
    }
    // Inside of a left turn is the left side; it is the mitre corner at (7, 3).
    expect(left[1][0]).toBeCloseTo(7, 9);
    expect(left[1][1]).toBeCloseTo(3, 9);
    expect(right[1][0]).toBeCloseTo(13, 9);
    expect(right[1][1]).toBeCloseTo(-3, 9);
  });

  it("clamps the mitre on hairpins with the mitre limit", () => {
    const hairpin: Vec2[] = [
      [0, 0],
      [20, 0],
      [0, 1],
    ];
    const { left, right } = ribbonOutline(hairpin, 2);
    for (const side of [left, right]) {
      expect(distance(side[1], hairpin[1])).toBeLessThanOrEqual(2 * DEFAULT_MITER_LIMIT + 1e-9);
    }
  });

  it("drops duplicated points instead of producing NaN", () => {
    const pts: Vec2[] = [
      [0, 0],
      [0, 0],
      [5, 0],
      [5, 0],
      [5, 5],
    ];
    expect(dedupePolyline(pts)).toHaveLength(3);
    const out = offsetPolyline(pts, 1);
    expect(out.flat().every(Number.isFinite)).toBe(true);
  });

  it("builds an upward-facing strip with along-the-road UVs", () => {
    const geometry = buildRibbonGeometry(
      [
        [0, 0],
        [10, 0],
        [20, 5],
      ],
      4,
      0.02,
    );
    const pos = geometry.getAttribute("position");
    const nor = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    expect(pos.count).toBe(12); // two segments, two triangles each
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(0.02, 9);
      expect([nor.getX(i), nor.getY(i), nor.getZ(i)]).toEqual([0, 1, 0]);
    }
    expect(windingMatchesNormals(geometry)).toBe(true);
    const maxU = Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)));
    expect(maxU).toBeCloseTo(10 + Math.hypot(10, 5), 6);
  });
});
