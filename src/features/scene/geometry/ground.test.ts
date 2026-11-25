import { Color } from "three";
import { describe, expect, it } from "vitest";
import { buildArea } from "@/domain/area/buildArea";
import fixture from "@/domain/__fixtures__/acoyte-rivadavia.overpass.json";
import type { OverpassResponse } from "@/domain/osm/overpass";
import type { Vec2 } from "@/domain/types";
import { LAYERS, PALETTE, SIDEWALK_WIDTH } from "../config/palette";
import { sampleArea } from "../testing/sampleArea";
import { triangles, windingMatchesNormals } from "../testing/geometryChecks";
import { buildKerbGeometry, buildParkGeometry, buildPolygonsTopGeometry } from "./groundGeometry";
import { buildGroundPlan } from "./groundPlan";
import { buildMarkingsGeometry, crosswalkStripes, MARKING_SPEC } from "./markings";
import { pointInRing, type PolygonWithHoles } from "./polygon2d";
import { analyzeRoadNetwork, legClearance } from "./roadNetwork";

function inside(p: Vec2, polygons: PolygonWithHoles[]): boolean {
  return polygons.some((poly) => pointInRing(p, poly.outer) && !poly.holes.some((h) => pointInRing(p, h)));
}

describe("road network", () => {
  it("finds the corner at the origin with its four legs, ignoring footways", () => {
    const network = analyzeRoadNetwork(sampleArea().roads);
    expect(network.roads.some((r) => r.cls === "footway")).toBe(false);
    expect(network.main?.point).toEqual([0, 0]);
    expect(network.main?.legs).toHaveLength(4);
    // A way split in the middle of a street (two arms) is not a junction.
    expect(network.junctions.every((j) => j.legs.length >= 3)).toBe(true);
  });
});

describe("crosswalks", () => {
  it("puts zebra stripes on every leg of the main intersection, clear of the crossing street", () => {
    const network = analyzeRoadNetwork(sampleArea().roads);
    const main = network.main!;
    const stripes = crosswalkStripes(main);
    for (const leg of main.legs) {
      const clearance = legClearance(main, leg);
      const onLeg = stripes.filter((s) => {
        const c = s.corners[0];
        return c[0] * leg.direction[0] + c[1] * leg.direction[1] > clearance;
      });
      expect(onLeg.length).toBeGreaterThanOrEqual(4);
    }
    for (const stripe of stripes) {
      for (const [x, y] of stripe.corners) {
        // Outside the crossing carriageway (avenue 18 m, street 13 m wide) and inside its own.
        const alongAvenue = Math.abs(y) <= 9 + 1e-6;
        const alongStreet = Math.abs(x) <= 6.5 + 1e-6;
        expect(alongAvenue || alongStreet).toBe(true);
        expect(Math.hypot(x, y)).toBeGreaterThan(6.5);
      }
    }
    const first = stripes[0].corners;
    expect(Math.hypot(first[1][0] - first[0][0], first[1][1] - first[0][1])).toBeCloseTo(MARKING_SPEC.crosswalkLength, 9);
  });

  it("keeps lane paint out of junction boxes and on the paint layer", () => {
    const network = analyzeRoadNetwork(sampleArea().roads);
    const geometry = buildMarkingsGeometry(network);
    const colour = geometry.getAttribute("color");
    const centre = new Color(PALETTE.markingCentre);
    let centreQuads = 0;
    for (const t of triangles(geometry)) {
      expect(t.a[1]).toBeCloseTo(LAYERS.marking, 6);
      const i = t.index * 3;
      const isCentre = Math.abs(colour.getX(i) - centre.r) < 1e-6 && Math.abs(colour.getY(i) - centre.g) < 1e-6;
      if (!isCentre) continue;
      centreQuads++;
      const mid: Vec2 = [(t.a[0] + t.b[0] + t.c[0]) / 3, -(t.a[2] + t.b[2] + t.c[2]) / 3];
      expect(Math.hypot(mid[0], mid[1])).toBeGreaterThan(network.main!.maxHalfWidth);
    }
    expect(centreQuads).toBeGreaterThan(20);
    expect(windingMatchesNormals(geometry)).toBe(true);
  });
});

describe("ground plan", () => {
  it("carves the carriageways out of the block plinths and leaves a sidewalk band", () => {
    const plan = buildGroundPlan(sampleArea());
    expect(plan.blocks).not.toBeNull();
    expect(plan.lots).not.toBeNull();
    const blocks = plan.blocks!;
    const lots = plan.lots!;
    // On the asphalt: not a block.
    expect(inside([50, 0], blocks)).toBe(false);
    expect(inside([0, 50], blocks)).toBe(false);
    expect(inside([3, 3], blocks)).toBe(false);
    // Middle of a block: block and lot.
    expect(inside([40, 40], blocks)).toBe(true);
    expect(inside([40, 40], lots)).toBe(true);
    // On the sidewalk next to the avenue: block, but not lot.
    const sidewalk: Vec2 = [40, 9 + SIDEWALK_WIDTH / 2];
    expect(inside(sidewalk, blocks)).toBe(true);
    expect(inside(sidewalk, lots)).toBe(false);
  });

  it("builds kerbs, tops and parks with consistent winding", () => {
    const plan = buildGroundPlan(sampleArea());
    const kerbs = buildKerbGeometry(plan.blocks!, plan.discRadius);
    expect(kerbs.getAttribute("position").count).toBeGreaterThan(0);
    expect(windingMatchesNormals(kerbs)).toBe(true);
    // Kerb faces look at the street: next to the avenue (y = +9 in domain) they face south (+z in three).
    for (const t of triangles(kerbs)) {
      const north = -(t.a[2] + t.b[2] + t.c[2]) / 3;
      const east = (t.a[0] + t.b[0] + t.c[0]) / 3;
      if (Math.abs(north - 9) < 0.01 && east > 20 && east < 100) expect(t.stored[2]).toBeGreaterThan(0.99);
    }
    const tops = buildPolygonsTopGeometry(plan.blocks!, LAYERS.sidewalk);
    expect(windingMatchesNormals(tops)).toBe(true);
    const parks = buildParkGeometry(plan.parks);
    expect(windingMatchesNormals(parks)).toBe(true);
    expect(plan.parks).toHaveLength(1);
  });

  it("handles the real Acoyte y Rivadavia data within a frame budget", () => {
    const area = buildArea({ origin: { lat: -34.6183, lng: -58.43646 }, osm: fixture as unknown as OverpassResponse });
    const started = performance.now();
    const plan = buildGroundPlan(area);
    const elapsed = performance.now() - started;
    expect(plan.blocks).not.toBeNull();
    expect(plan.blocks!.length).toBeGreaterThan(10);
    expect(plan.network.main).not.toBeNull();
    expect(plan.network.main!.legs.length).toBeGreaterThanOrEqual(3);
    // Generous: this runs once per area, and a CI box is slower than a laptop.
    expect(elapsed).toBeLessThan(1500);
    // No building footprint centre sits on asphalt.
    for (const b of area.buildings) {
      const [x, y] = b.footprint.reduce<Vec2>((acc, p) => [acc[0] + p[0] / b.footprint.length, acc[1] + p[1] / b.footprint.length], [0, 0]);
      expect(inside([x, y], plan.blocks!)).toBe(true);
    }
  });
});
