import { describe, expect, it } from "vitest";
import type { Building, Ring } from "@/domain/types";
import { podiumAndTower, rect } from "../testing/sampleArea";
import { coplanarOverlaps, dot, triangles, windingMatchesNormals } from "../testing/geometryChecks";
import { BUILDING_SPEC, buildBuildingGeometry, FACADE_ATTRIBUTE } from "./buildingGeometry";
import { floorHeightOf } from "./buildingPlan";

function building(overrides: Partial<Building> & { footprint: Ring }): Building {
  const height = overrides.height ?? 12;
  return {
    id: "b",
    parts: [{ footprint: overrides.footprint, height }],
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

describe("multi-part buildings", () => {
  /** Triangles of a geometry whose three corners all satisfy `inside` (three space). */
  function facesWhere(geometry: ReturnType<typeof buildBuildingGeometry>["geometry"], inside: (p: [number, number, number]) => boolean) {
    return [...triangles(geometry)].filter((t) => inside(t.a) && inside(t.b) && inside(t.c));
  }
  const windowed = (geometry: ReturnType<typeof buildBuildingGeometry>["geometry"], index: number) => geometry.getAttribute(FACADE_ATTRIBUTE).getZ(index * 3) > 0;

  it("merges every part into one geometry, winding matching normals and no coplanar overlaps", () => {
    const data = buildBuildingGeometry(podiumAndTower());
    expect(data.partCount).toBe(3);
    expect(windingMatchesNormals(data.geometry)).toBe(true);
    expect(coplanarOverlaps(data.geometry)).toEqual([]);
    // Every part starts at the ground.
    let minY = Infinity;
    const pos = data.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
    expect(minY).toBeCloseTo(0, 6);
  });

  it("draws no wall between abutting parts of equal height, and only the exposed band above a lower neighbour", () => {
    const equal = building({ footprint: rect(0, 0, 20, 10), parts: [{ footprint: rect(0, 0, 10, 10), height: 12 }, { footprint: rect(10, 0, 20, 10), height: 12 }] });
    const flat = buildBuildingGeometry(equal);
    expect(coplanarOverlaps(flat.geometry)).toEqual([]);
    expect(facesWhere(flat.geometry, ([x]) => Math.abs(x - 10) < 1e-6)).toEqual([]);

    const stepped = building({ footprint: rect(0, 0, 20, 10), height: 30, levels: 10, parts: [{ footprint: rect(0, 0, 10, 10), height: 9 }, { footprint: rect(10, 0, 20, 10), height: 30 }] });
    const data = buildBuildingGeometry(stepped);
    expect(windingMatchesNormals(data.geometry)).toBe(true);
    expect(coplanarOverlaps(data.geometry)).toEqual([]);
    const shared = facesWhere(data.geometry, ([x]) => Math.abs(x - 10) < 1e-6);
    expect(shared.length).toBeGreaterThan(0);
    // The tower's wall over the podium starts at the podium's parapet, never down inside it.
    for (const t of shared) expect(Math.min(t.a[1], t.b[1], t.c[1])).toBeGreaterThanOrEqual(9 - 1e-6);
  });

  it("keeps rooftop volumes and tiny parts as solid clay, without windows", () => {
    const tower = buildBuildingGeometry(podiumAndTower());
    const inMachineRoom = ([x, y, z]: [number, number, number]) => x >= -68 - 1e-6 && x <= -62 + 1e-6 && -z >= 46 - 1e-6 && -z <= 52 + 1e-6 && y > 75.6 + 1e-6;
    const machineRoomFaces = facesWhere(tower.geometry, inMachineRoom);
    expect(machineRoomFaces.length).toBeGreaterThan(0);
    for (const t of machineRoomFaces) expect(windowed(tower.geometry, t.index)).toBe(false);
    // The podium's street front does carry windows.
    expect(facesWhere(tower.geometry, ([, , z]) => Math.abs(-z - 20) < 1e-6).some((t) => windowed(tower.geometry, t.index))).toBe(true);

    const withKiosk = buildBuildingGeometry(
      building({ footprint: rect(0, 0, 14, 10), parts: [{ footprint: rect(0, 0, 10, 10), height: 12 }, { footprint: rect(10, 0, 14, 4), height: 6 }] }),
    );
    // The kiosk's own faces; the main part's wall above it, on the plane x = 10, keeps its windows.
    const kiosk = facesWhere(withKiosk.geometry, ([x, , z]) => x >= 10 - 1e-6 && -z <= 4 + 1e-6).filter((t) => (t.a[0] + t.b[0] + t.c[0]) / 3 > 10 + 1e-3);
    expect(kiosk.length).toBeGreaterThan(0);
    for (const t of kiosk) expect(windowed(withKiosk.geometry, t.index)).toBe(false);
  });

  it("uses the GCBA's real 2.8 m storeys, and height / levels for other sources", () => {
    expect(floorHeightOf(podiumAndTower())).toBe(2.8);
    expect(floorHeightOf(building({ footprint: rect(0, 0, 10, 10), height: 12, levels: 4 }))).toBe(3);
    expect(floorHeightOf(building({ footprint: rect(0, 0, 10, 10), height: 40, levels: 4 }))).toBe(4.2);
  });

  it("adds no procedural machine room to GCBA buildings, which carry the real ones, and hangs the tag on the tallest part", () => {
    const data = buildBuildingGeometry(podiumAndTower());
    expect(data.wallHeight).toBeCloseTo(78.4, 6);
    expect(data.topHeight).toBeCloseTo(78.4, 6);
    const [x, y, z] = data.tagAnchor;
    expect(y).toBeCloseTo(78.4, 6);
    expect(x).toBeCloseTo(-65, 6);
    expect(-z).toBeCloseTo(49, 6);
    // A podium and tower from OpenStreetMap, which has no rooftop volumes, gets an invented machine room on the tower.
    const gcba = podiumAndTower();
    const osm = buildBuildingGeometry({ ...gcba, heightSource: "osm", parts: [gcba.parts[0], { footprint: rect(-80, 32, -50, 52), height: 75.6 }], height: 75.6 });
    expect(osm.topHeight).toBeGreaterThan(osm.rimHeight + 1);
  });
});
