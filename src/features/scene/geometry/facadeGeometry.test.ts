import { describe, expect, it } from "vitest";
import type { Building, Vec2 } from "@/domain/types";
import { rect } from "../testing/sampleArea";
import { windingMatchesNormals } from "../testing/geometryChecks";
import { buildFacadeGeometry, FACADE_PHOTO_SPEC, facadeLayout, frontWallHeight } from "./facadeGeometry";

// The south wall of a 10 m wide lot, street to the south: normal (0, -1) locally, +Z in three.
const FRONT: [Vec2, Vec2] = [
  [0, 12],
  [10, 12],
];
const { crop, offset } = FACADE_PHOTO_SPEC;

function attr(geometry: ReturnType<typeof buildFacadeGeometry>, name: string) {
  const a = geometry.getAttribute(name);
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: a.itemSize }, (__, k) => a.getComponent(i, k)));
}

describe("facade photo quad", () => {
  it("sits on the front edge, pushed out toward the street, and faces it", () => {
    const g = buildFacadeGeometry(FRONT, 30, 550 / 411);
    const positions = attr(g, "position");
    for (const [x, , z] of positions) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
      // Local north 12 maps to z = -12; the street side (south) is +z.
      expect(z).toBeCloseTo(-12 + offset, 6);
    }
    expect(Math.min(...positions.map((p) => p[1]))).toBe(0);
    for (const nrm of attr(g, "normal")) expect(nrm).toEqual([0, 0, 1]);
    expect(windingMatchesNormals(g)).toBe(true);
  });

  it("fills the width keeping the aspect, anchored at the ground, and fades a short photo into the clay", () => {
    const aspect = 550 / 411;
    const g = buildFacadeGeometry(FRONT, 30, aspect);
    const photoHeight = 10 / aspect;
    const positions = attr(g, "position");
    const uvs = attr(g, "uv");
    const colors = attr(g, "color");
    expect(Math.max(...positions.map((p) => p[1]))).toBeCloseTo(photoHeight, 5);
    positions.forEach(([x, y], i) => {
      const [u, v] = uvs[i];
      // u follows the wall from the viewer's left; v = crop at the ground, 1 - crop at the photo's top.
      expect(u).toBeCloseTo(crop + (1 - 2 * crop) * (x / 10), 5);
      expect(v).toBeCloseTo(crop + (1 - 2 * crop) * (y / photoHeight), 5);
      if (y === 0) expect(colors[i][3]).toBe(1);
      if (Math.abs(y - photoHeight) < 1e-4) expect(colors[i][3]).toBe(0);
    });
  });

  it("cuts a photo taller than the wall at the top, without a fade", () => {
    const layout = facadeLayout(10, 5, 550 / 411);
    expect(layout.height).toBe(5);
    expect(layout.fadeFrom).toBe(5);
    expect(layout.vTop).toBeCloseTo(crop + (1 - 2 * crop) * (5 / (10 / (550 / 411))), 6);
    const g = buildFacadeGeometry(FRONT, 5, 550 / 411);
    expect(attr(g, "color").every((c) => c[3] === 1)).toBe(true);
    expect(g.getAttribute("position").count).toBe(6);
  });

  it("takes the height of the part behind the front, not of a tower set back", () => {
    const podium = rect(0, 12, 10, 20);
    const tower = rect(0, 20, 10, 30);
    const b = {
      id: "b",
      footprint: rect(0, 12, 10, 30),
      parts: [
        { footprint: podium, height: 9 },
        { footprint: tower, height: 40 },
      ],
      height: 40,
    } as unknown as Building;
    expect(frontWallHeight(b, FRONT)).toBe(9);
  });
});
