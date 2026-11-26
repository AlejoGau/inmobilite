import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildingsFromTejido } from "@/domain/area/gcbaBuildings";
import { createProjection } from "@/domain/geo/projection";
import { tilesCoveringRadius } from "@/domain/geo/tiles";
import { MAX_BUILDINGS } from "@/domain/types";
import { decodeTejidoTile } from "@/infra/gcba/tejido";
import { coplanarOverlaps, windingMatchesNormals } from "../testing/geometryChecks";
import { buildBuildingGeometry } from "./buildingGeometry";

const ACOYTE_Y_RIVADAVIA = { lng: -58.43646, lat: -34.6183 };

/** The 20 buildings around Acoyte y Rivadavia from the real GCBA tiles saved in the repo. */
function acoyteBuildings() {
  const dir = path.join(__dirname, "../../../infra/gcba/__fixtures__");
  const pieces = tilesCoveringRadius(ACOYTE_Y_RIVADAVIA, 160, 17).flatMap((tile) =>
    decodeTejidoTile(new Uint8Array(readFileSync(path.join(dir, `tejido-17-${tile.x}-${tile.y}.pbf.gz`))), tile),
  );
  return buildingsFromTejido(pieces, createProjection(ACOYTE_Y_RIVADAVIA), ACOYTE_Y_RIVADAVIA);
}

describe("building geometry on real GCBA data (Acoyte y Rivadavia)", () => {
  const buildings = acoyteBuildings();

  it("builds every building quickly, one geometry each, with every part", () => {
    expect(buildings).toHaveLength(MAX_BUILDINGS);
    const start = performance.now();
    const meshes = buildings.map(buildBuildingGeometry);
    const elapsed = performance.now() - start;
    // Generous for CI; on a laptop it is a few tens of ms.
    expect(elapsed).toBeLessThan(1500);
    const parts = meshes.reduce((sum, m) => sum + m.partCount, 0);
    expect(parts).toBeGreaterThan(MAX_BUILDINGS);
    expect(parts).toBeLessThan(400);
    meshes.forEach((m, i) => {
      expect(m.partCount).toBeGreaterThan(0);
      expect(m.wallHeight).toBeCloseTo(Math.max(...buildings[i].parts.map((p) => p.height)), 5);
    });
  });

  it("winds every face to match its normal and leaves no coplanar overlaps (no z-fighting)", () => {
    for (const building of buildings) {
      const { geometry } = buildBuildingGeometry(building);
      expect(windingMatchesNormals(geometry), building.smp).toBe(true);
      expect(coplanarOverlaps(geometry, 0.01), building.smp).toEqual([]);
    }
  });

  it("puts no procedural machine room on GCBA buildings: the real ones are parts", () => {
    for (const building of buildings) {
      const mesh = buildBuildingGeometry(building);
      expect(mesh.topHeight, building.smp).toBeLessThanOrEqual(mesh.rimHeight + 1e-6);
    }
  });
});
