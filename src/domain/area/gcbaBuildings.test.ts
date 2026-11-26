import { readFileSync } from "node:fs";
import path from "node:path";
import { intersect } from "@turf/intersect";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import { describe, expect, it } from "vitest";
import { createProjection } from "../geo/projection";
import { polygonArea, signedArea } from "../geo/polygon";
import { tilesCoveringRadius } from "../geo/tiles";
import { hashString } from "../seed";
import { MAX_BUILDINGS, type Building, type Ring, type Vec2 } from "../types";
import { decodeTejidoTile } from "@/infra/gcba/tejido";
import { buildingsFromTejido, removeHoles, type TejidoPiece } from "./gcbaBuildings";

const ACOYTE_Y_RIVADAVIA = { lng: -58.43646, lat: -34.6183 };
const projection = createProjection(ACOYTE_Y_RIVADAVIA);

// ---------------------------------------------------------------- helpers

function overlap(a: Ring, b: Ring): number {
  const shared = intersect(featureCollection([turfPolygon([[...a, a[0]]]), turfPolygon([[...b, b[0]]])]));
  if (!shared) return 0;
  const polygons = shared.geometry.type === "Polygon" ? [shared.geometry.coordinates] : shared.geometry.coordinates;
  return polygons.reduce((sum, poly) => sum + polygonArea(poly[0].map((p): Vec2 => [p[0], p[1]])), 0);
}

function worstPartOverlap(building: Building): number {
  let worst = 0;
  for (let i = 0; i < building.parts.length; i++) {
    for (let j = i + 1; j < building.parts.length; j++) {
      worst = Math.max(worst, overlap(building.parts[i].footprint, building.parts[j].footprint));
    }
  }
  return worst;
}

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** A synthetic piece whose rings are given in local meters around the corner. */
function piece(pieceId: number, smp: string, height: number, ...rings: Vec2[][]): TejidoPiece {
  return {
    pieceId,
    smp,
    height,
    rings: rings.map((ring) =>
      ring.map((p): [number, number] => {
        const { lng, lat } = projection.toLngLat(p);
        return [lng, lat];
      }),
    ),
  };
}

function build(pieces: TejidoPiece[]): Building[] {
  return buildingsFromTejido(pieces, projection, ACOYTE_Y_RIVADAVIA);
}

/** The real z17 tiles around Acoyte y Rivadavia, saved on 2026-11-25 (gzipped, as served). */
function fixturePieces(): TejidoPiece[] {
  const dir = path.join(__dirname, "../../infra/gcba/__fixtures__");
  return tilesCoveringRadius(ACOYTE_Y_RIVADAVIA, 160, 17).flatMap((tile) =>
    decodeTejidoTile(new Uint8Array(readFileSync(path.join(dir, `tejido-17-${tile.x}-${tile.y}.pbf.gz`))), tile),
  );
}

// ---------------------------------------------------------------- real data

describe("buildingsFromTejido at Acoyte y Rivadavia (real GCBA tiles)", () => {
  const pieces = fixturePieces();
  const buildings = build(pieces);
  const bySmp = new Map(buildings.map((b) => [b.smp, b]));

  it("models the MAX_BUILDINGS closest parcels, closest first", () => {
    expect(buildings).toHaveLength(MAX_BUILDINGS);
    const distances = buildings.map((b) => b.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(buildings[0].distance).toBeLessThan(40);
    expect(buildings[MAX_BUILDINGS - 1].distance).toBeLessThan(80);
  });

  it("includes the three towers OpenStreetMap barely has, at their measured height", () => {
    expect(bySmp.get("040-088-010")?.height).toBeCloseTo(42, 5); // Rivadavia 4990
    expect(bySmp.get("045-068-019")?.height).toBeCloseTo(44.8, 5); // Rivadavia 5013
    const stepped = bySmp.get("040-088-009D"); // Rivadavia 4982, stepped crown
    expect(stepped?.height).toBeCloseTo(44.8, 5);
    const towerHeights = new Set(stepped?.parts.map((p) => p.height).filter((h) => h > 30));
    expect([...towerHeights].sort()).toEqual([36.4, 39.2, 42, 44.8]);
  });

  it("keeps the podium and the tower of a parcel as separate parts", () => {
    const b = bySmp.get("045-079-013B");
    expect(b).toBeDefined();
    const heights = new Set(b?.parts.map((p) => p.height));
    expect(heights).toEqual(new Set([5.2, 8.8, 25.8, 28.9, 32.8]));
    expect(b?.height).toBe(32.8);
    expect(b?.levels).toBe(12);
    expect(b?.footprint.length).toBeGreaterThanOrEqual(4);
  });

  it("never stacks two parts of a building on the same ground (tile-edge rule and source overlaps)", () => {
    for (const b of buildings) expect(worstPartOverlap(b), b.smp).toBeLessThan(0.5);
  });

  it("keeps neighbouring buildings apart too", () => {
    const parts = buildings.flatMap((b) => b.parts.map((p) => ({ smp: b.smp, ring: p.footprint })));
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[i].smp !== parts[j].smp) expect(overlap(parts[i].ring, parts[j].ring)).toBeLessThan(0.5);
      }
    }
  });

  it("emits counter-clockwise rings without a closing point", () => {
    for (const b of buildings) {
      for (const ring of [b.footprint, ...b.parts.map((p) => p.footprint)]) {
        expect(signedArea(ring)).toBeGreaterThan(0);
        expect(ring[0]).not.toEqual(ring[ring.length - 1]);
      }
    }
  });

  it("fills every field of the contract", () => {
    for (const b of buildings) {
      expect(b.id).toBe(`gcba:${b.smp}`);
      expect(b.heightSource).toBe("gcba");
      expect(b.use).toBe("residential");
      expect(b.name).toBeUndefined();
      expect(b.seed).toBe(hashString(b.id));
      expect(b.height).toBe(Math.max(...b.parts.map((p) => p.height)));
      expect(b.levels).toBe(Math.max(1, Math.round(b.height / 2.8)));
      expect(b.parts.every((p) => p.height > 0 && polygonArea(p.footprint) >= 2)).toBe(true);
      const partsArea = b.parts.reduce((sum, p) => sum + polygonArea(p.footprint), 0);
      expect(b.area).toBeCloseTo(partsArea, 0);
      // The outline is the largest island of the parts' union: at least as big as any part.
      // Several towers here stand in islands split by voids (040-088-009D: 276 of 485 m²).
      const largestPart = Math.max(...b.parts.map((p) => polygonArea(p.footprint)));
      expect(polygonArea(b.footprint)).toBeGreaterThanOrEqual(largestPart - 0.01);
      expect(polygonArea(b.footprint)).toBeLessThanOrEqual(partsArea * 1.5);
    }
  });

  it("is deterministic, whatever order the tiles arrive in", () => {
    expect(build(fixturePieces())).toEqual(buildings);
    expect(build([...pieces].reverse())).toEqual(buildings);
  });
});

// ---------------------------------------------------------------- synthetic cases

describe("buildingsFromTejido rules", () => {
  it("drops voids, patios and slivers", () => {
    const [b] = build([
      piece(1, "001-001-001", 9, rect(10, 10, 20, 20)),
      piece(2, "001-001-001", 0, rect(20, 10, 25, 20)), // patio
      piece(3, "001-001-001", 9, rect(25, 10, 26, 11)), // 1 m² sliver
      piece(4, "001-001-002", 0, rect(40, 40, 50, 50)), // a parcel that is all void
    ]);
    expect(build([piece(4, "001-001-002", 0, rect(40, 40, 50, 50))])).toEqual([]);
    expect(b.parts).toHaveLength(1);
    expect(b.area).toBe(100);
  });

  it("welds back a piece that a tile edge cut in two", () => {
    const [b] = build([piece(7, "001-001-001", 12, rect(0, 10, 5, 20), rect(5, 10, 9, 20))]);
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0].footprint).toHaveLength(4);
    expect(b.area).toBe(90);
  });

  it("lets the taller piece keep ground that two pieces both claim", () => {
    const [b] = build([
      piece(1, "001-001-001", 8.4, rect(0, 0, 30, 30)), // podium drawn without a hole
      piece(2, "001-001-001", 30.8, rect(10, 10, 20, 20)), // tower inside it
      piece(3, "001-001-001", 30.8, rect(12, 12, 14, 14)), // duplicate inside the tower
    ]);
    expect(worstPartOverlap(b)).toBeLessThan(0.01);
    expect(b.parts.filter((p) => p.height === 30.8)).toHaveLength(1);
    const podiumArea = b.parts.filter((p) => p.height === 8.4).reduce((sum, p) => sum + polygonArea(p.footprint), 0);
    expect(podiumArea).toBeCloseTo(800, 3);
    expect(b.area).toBeCloseTo(900, 3);
    expect(b.height).toBe(30.8);
    expect(b.levels).toBe(11);
    expect(polygonArea(b.footprint)).toBeCloseTo(900, 3);
  });

  it("keeps only the MAX_BUILDINGS closest parcels, ties broken by smp", () => {
    const pieces: TejidoPiece[] = [];
    for (let i = 0; i < 30; i++) {
      const x = 15 * i;
      // Mirrored pairs sit at the same distance, so the smp has to break the tie.
      pieces.push(piece(i * 2, `002-${String(i).padStart(3, "0")}-B`, 6, rect(x, -5, x + 10, 5)));
      pieces.push(piece(i * 2 + 1, `002-${String(i).padStart(3, "0")}-A`, 6, rect(-x - 10, -5, -x, 5)));
    }
    const buildings = build(pieces);
    expect(buildings).toHaveLength(MAX_BUILDINGS);
    expect(buildings.slice(0, 4).map((b) => b.smp)).toEqual(["002-000-A", "002-000-B", "002-001-A", "002-001-B"]);
    expect(buildings[MAX_BUILDINGS - 1].smp).toBe("002-009-B");
  });
});

describe("removeHoles", () => {
  it("cuts a holed polygon into hole-free polygons of the same area", () => {
    const closed = (ring: Vec2[]) => [...ring, ring[0]];
    const outer = closed(rect(0, 0, 10, 10));
    const hole = closed(rect(3, 3, 6, 6).reverse());
    const pieces = removeHoles([outer, hole]);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(pieces.every((p) => p.length === 1)).toBe(true);
    const total = pieces.reduce((sum, p) => sum + polygonArea(p[0].map((q): Vec2 => [q[0], q[1]])), 0);
    expect(total).toBeCloseTo(100 - 9, 6);
  });

  it("leaves a simple polygon alone", () => {
    const simple = [[...rect(0, 0, 1, 1), [0, 0]]];
    expect(removeHoles(simple)).toEqual([simple]);
  });
});
