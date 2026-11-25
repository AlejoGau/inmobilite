import { describe, expect, it } from "vitest";
import type { Building, Ring } from "@/domain/types";
import { rect } from "../testing/sampleArea";
import { dot, triangles, windingMatchesNormals } from "../testing/geometryChecks";
import { BUILDING_SPEC, buildBuildingGeometry, FACADE_ATTRIBUTE } from "./buildingGeometry";

function building(overrides: Partial<Building> & { footprint: Ring }): Building {
  return {
    id: "b",
    height: 12,
    levels: 4,
    heightSource: "osm",
    use: "residential",
    area: 200,
    distance: 20,
    seed: 42,
    ...overrides,
  };
}

/** An L-shaped (concave) footprint, CCW. */
const L_SHAPE: Ring = [
  [0, 0],
  [20, 0],
  [20, 8],
  [8, 8],
  [8, 20],
  [0, 20],
];

describe("building extrusion", () => {
  it("winds every face to match its normal, for convex and concave footprints and both orientations", () => {
    for (const footprint of [rect(0, 0, 12, 20), L_SHAPE, [...L_SHAPE].reverse()]) {
      const { geometry } = buildBuildingGeometry(building({ footprint, levels: 9, height: 27 }));
      expect(windingMatchesNormals(geometry)).toBe(true);
    }
  });

  it("points facade normals outwards and horizontally", () => {
    const { geometry } = buildBuildingGeometry(building({ footprint: rect(0, 0, 10, 10) }));
    const facade = geometry.getAttribute(FACADE_ATTRIBUTE);
    const centre = [5, 0, -5];
    let walls = 0;
    for (const t of triangles(geometry)) {
      if (facade.getZ(t.index * 3) <= 0) continue; // not a facade
      walls++;
      expect(t.stored[1]).toBe(0);
      const mid = [(t.a[0] + t.b[0] + t.c[0]) / 3 - centre[0], 0, (t.a[2] + t.b[2] + t.c[2]) / 3 - centre[2]];
      expect(dot(mid, t.stored)).toBeGreaterThan(0);
    }
    expect(walls).toBe(8); // four walls, two triangles each
  });

  it("maps facade UVs in meters: u along the perimeter, v = height", () => {
    const { geometry, rimHeight } = buildBuildingGeometry(building({ footprint: rect(0, 0, 10, 6) }));
    const uv = geometry.getAttribute("uv");
    const facade = geometry.getAttribute(FACADE_ATTRIBUTE);
    const pos = geometry.getAttribute("position");
    let maxU = 0;
    for (let i = 0; i < uv.count; i++) {
      if (facade.getZ(i) <= 0) continue;
      maxU = Math.max(maxU, uv.getX(i));
      expect(uv.getY(i)).toBeCloseTo(pos.getY(i), 9);
      // The edge-local u is centred: it spans [-half, +half] of its edge.
      expect(Math.abs(facade.getX(i))).toBeCloseTo(facade.getZ(i), 9);
    }
    expect(maxU).toBeCloseTo(32, 9); // perimeter of 10 x 6
    expect(rimHeight).toBeCloseTo(12 + BUILDING_SPEC.parapetTall, 9);
  });

  it("adds a parapet ring and keeps the roof inside it", () => {
    const data = buildBuildingGeometry(building({ footprint: rect(0, 0, 10, 10), height: 9, levels: 3 }));
    const pos = data.geometry.getAttribute("position");
    const ys = new Set<number>();
    for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1000) / 1000);
    expect(ys.has(9)).toBe(true); // roof slab
    expect(ys.has(10)).toBe(true); // parapet top
    expect(data.rimHeight).toBe(10);
    expect(data.topHeight).toBe(10);
  });

  it("puts a seeded machine room on tall buildings, deterministically", () => {
    const tall = building({ footprint: rect(0, 0, 18, 24), height: 30, levels: 10, seed: 7 });
    const a = buildBuildingGeometry(tall);
    const b = buildBuildingGeometry(tall);
    expect(a.topHeight).toBeGreaterThan(a.rimHeight + 1);
    expect(Array.from(a.geometry.getAttribute("position").array)).toEqual(Array.from(b.geometry.getAttribute("position").array));

    const low = buildBuildingGeometry(building({ footprint: rect(0, 0, 18, 24), height: 15, levels: BUILDING_SPEC.rooftopMinLevels }));
    expect(low.topHeight).toBe(low.rimHeight);
  });

  it("skips the parapet when the footprint is too thin to inset", () => {
    const sliver = buildBuildingGeometry(building({ footprint: rect(0, 0, 0.5, 10), height: 6, levels: 2 }));
    expect(sliver.rimHeight).toBe(6);
    expect(windingMatchesNormals(sliver.geometry)).toBe(true);
  });
});
