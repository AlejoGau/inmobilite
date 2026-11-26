import { readFileSync } from "node:fs";
import path from "node:path";
import { intersect } from "@turf/intersect";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import { describe, expect, it } from "vitest";
import { decodeVectorTile } from "@/infra/tiles/vectorTile";
import { decodeOpenFreeMapTile, OPENFREEMAP_LAYERS } from "@/infra/openfreemap/tiles";
import { tileBounds } from "@/infra/openfreemap/clipToTile";
import type { TileId } from "../geo/tiles";
import { createProjection } from "../geo/projection";
import { polygonArea } from "../geo/polygon";
import { closestPointOnPolyline } from "../geo/polyline";
import { distance, dot, sub } from "../geo/vec";
import { MAX_BUILDINGS, type LngLat, type Ring, type Road, type Vec2 } from "../types";
import { rankStreets } from "./labels";
import { contextFromTiles, DEFAULT_RENDER_HEIGHT, tileRoadClass, type VectorFeature } from "./tileContext";

/** Real OpenFreeMap tiles saved on 2026-11-25 (build 20261122_124456_pt). */
const FIXTURES = path.join(__dirname, "../../infra/openfreemap/__fixtures__");
const ACOYTE_Y_RIVADAVIA: LngLat = { lng: -58.43646, lat: -34.6183 };
const RADIUS = 300;
const CLIP_RADIUS = RADIUS + 30;
/** The tile holding the corner (it alone covers 330 m around it), and the one north of it. */
const SOUTH_TILE: TileId = { z: 14, x: 5532, y: 9873 };
const NORTH_TILE: TileId = { z: 14, x: 5532, y: 9872 };
/** On Avenida Acoyte, right on the edge between the two tiles: the model there is built from both. */
const ON_TILE_EDGE: LngLat = { lng: ACOYTE_Y_RIVADAVIA.lng, lat: tileBounds(SOUTH_TILE).north };

function fixtureBytes(tile: TileId): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, `ofm-${tile.z}-${tile.x}-${tile.y}.pbf`)));
}

const southFeatures = decodeOpenFreeMapTile(fixtureBytes(SOUTH_TILE), SOUTH_TILE);
const northFeatures = decodeOpenFreeMapTile(fixtureBytes(NORTH_TILE), NORTH_TILE);

/** The same tiles WITHOUT the clip to the tile bounds: copies overlap in the tile buffer. */
function unclipped(tile: TileId): VectorFeature[] {
  return decodeVectorTile(fixtureBytes(tile), tile, OPENFREEMAP_LAYERS).map((f) => ({ ...f, tile }));
}

const corner = contextFromTiles(southFeatures, createProjection(ACOYTE_Y_RIVADAVIA), RADIUS);
const edge = contextFromTiles([...southFeatures, ...northFeatures], createProjection(ON_TILE_EDGE), RADIUS);

/** Pairs of segments from different roads that lie on top of each other for more than 10 cm. */
function overlappingSegments(roads: Road[]): string[] {
  const segments = roads.flatMap((road) => road.points.slice(1).map((b, i) => ({ id: road.id, a: road.points[i], b })));
  const found: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const [s, t] = [segments[i], segments[j]];
      if (s.id !== t.id && collinearOverlap(s.a, s.b, t.a, t.b) > 0.1) found.push(`${s.id} / ${t.id}`);
    }
  }
  return found;
}

function collinearOverlap(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const len = distance(a, b);
  if (len === 0) return 0;
  const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const offset = (p: Vec2) => Math.abs(dir[0] * (p[1] - a[1]) - dir[1] * (p[0] - a[0]));
  if (offset(c) > 0.05 || offset(d) > 0.05) return 0;
  const [t0, t1] = [dot(sub(c, a), dir), dot(sub(d, a), dir)].sort((x, y) => x - y);
  return Math.min(len, t1) - Math.max(0, t0);
}

/** Largest overlap area (m²) between any two rings. Planar: turf only does the clipping. */
function maxPairwiseOverlap(rings: Ring[]): number {
  const polygons = rings.map((r) => turfPolygon([[...r, r[0]].map((p) => [p[0], p[1]])]));
  let worst = 0;
  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      const both = intersect(featureCollection([polygons[i], polygons[j]]));
      if (!both) continue;
      const outers = both.geometry.type === "Polygon" ? [both.geometry.coordinates[0]] : both.geometry.coordinates.map((p) => p[0]);
      const overlap = outers.reduce((sum, ring) => sum + polygonArea(ring.map((p): Vec2 => [p[0], p[1]])), 0);
      worst = Math.max(worst, overlap);
    }
  }
  return worst;
}

function closestDistance(road: Road): number {
  return closestPointOnPolyline([0, 0], road.points).distance;
}

function vertexKey(p: Vec2): string {
  return `${p[0]},${p[1]}`;
}

/** Points where segments of a and b cross in their interiors. */
function crossings(a: Vec2[], b: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const r = sub(a[i + 1], a[i]);
      const s = sub(b[j + 1], b[j]);
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-9) continue;
      const qp = sub(b[j], a[i]);
      const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
      const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) out.push([a[i][0] + r[0] * t, a[i][1] + r[1] * t]);
    }
  }
  return out;
}

describe("contextFromTiles: roads", () => {
  it.each([
    ["Avenida Rivadavia", "primary"],
    ["Avenida Acoyte", "secondary"],
    ["Avenida José María Moreno", "secondary"],
  ])("names %s (%s) at the corner", (name, cls) => {
    const roads = corner.roads.filter((r) => r.name === name);
    expect(roads.length).toBeGreaterThan(0);
    expect(new Set(roads.map((r) => r.cls))).toEqual(new Set([cls]));
    expect(Math.min(...roads.map(closestDistance))).toBeLessThan(5);
  });

  it("gives the street ranking (labels, stats.streets) the three streets of the corner first", () => {
    const streets = rankStreets(corner.roads).map((s) => s.name);
    expect(streets.slice(0, 3).sort()).toEqual(["Avenida Acoyte", "Avenida José María Moreno", "Avenida Rivadavia"]);
    expect(streets.length).toBeGreaterThan(10);
  });

  it("splits a merged tile line where the street changes name (Acoyte becomes José María Moreno)", () => {
    // The tile has one "secondary" line through the corner: Acoyte to the north, Moreno to the south.
    for (const road of corner.roads.filter((r) => r.name === "Avenida Acoyte")) {
      expect(road.points.every((p) => p[1] > -2)).toBe(true);
    }
    for (const road of corner.roads.filter((r) => r.name === "Avenida José María Moreno")) {
      expect(road.points.every((p) => p[1] < 2)).toBe(true);
    }
  });

  it("puts a shared vertex at the corner, where the scene looks for the junction", () => {
    const counts = new Map<string, number>();
    for (const road of corner.roads) {
      for (const p of road.points) if (distance(p, [0, 0]) < 3) counts.set(vertexKey(p), (counts.get(vertexKey(p)) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
  });

  it("re-nodes crossings the z14 simplification left without a vertex", () => {
    const carriageways = corner.roads.filter((r) => r.cls !== "footway" && r.cls !== "pedestrian");
    let unnoded = 0;
    for (const a of carriageways) {
      for (const b of carriageways) {
        if (a.id >= b.id) continue;
        for (const x of crossings(a.points, b.points)) {
          const shared = a.points.some((p) => distance(p, x) < 0.01) && b.points.some((p) => distance(p, x) < 0.01);
          if (!shared) unnoded++;
        }
      }
    }
    expect(unnoded).toBe(0);
  });

  it("uses the widths of roads.ts and stays inside radius + ROAD_CLIP_MARGIN", () => {
    const widths = new Map(corner.roads.map((r) => [r.cls, r.width]));
    expect(widths.get("primary")).toBe(18);
    expect(widths.get("secondary")).toBe(13);
    for (const road of corner.roads) {
      expect(road.points.every((p) => Math.hypot(p[0], p[1]) <= CLIP_RADIUS + 1e-3)).toBe(true);
    }
  });

  it("maps the OpenMapTiles classes and drops rail, subway, platforms, tunnels and construction", () => {
    const f = (properties: VectorFeature["properties"]): VectorFeature => ({
      layer: "transportation",
      geometry: { type: "LineString", coordinates: [] },
      properties,
    });
    expect(tileRoadClass(f({ class: "rail", subclass: "rail" }))).toBeNull();
    expect(tileRoadClass(f({ class: "transit", subclass: "subway", brunnel: "tunnel", layer: -2 }))).toBeNull();
    expect(tileRoadClass(f({ class: "path", subclass: "platform" }))).toBeNull();
    expect(tileRoadClass(f({ class: "minor", brunnel: "tunnel", layer: -1 }))).toBeNull();
    expect(tileRoadClass(f({ class: "path", subclass: "footway", layer: -1 }))).toBeNull();
    expect(tileRoadClass(f({ class: "service_construction" }))).toBeNull();
    expect(tileRoadClass(f({ class: "ferry" }))).toBeNull();
    expect(tileRoadClass(f({ class: "aerialway" }))).toBeNull();
    expect(tileRoadClass(f({ class: "motorway", brunnel: "bridge", layer: 1 }))).toBe("primary");
    expect(tileRoadClass(f({ class: "trunk" }))).toBe("primary");
    expect(tileRoadClass(f({ class: "tertiary" }))).toBe("tertiary");
    expect(tileRoadClass(f({ class: "minor" }))).toBe("residential");
    expect(tileRoadClass(f({ class: "service" }))).toBe("service");
    expect(tileRoadClass(f({ class: "path", subclass: "pedestrian" }))).toBe("pedestrian");
    expect(tileRoadClass(f({ class: "path", subclass: "steps" }))).toBe("footway");
    expect(tileRoadClass(f({ class: "path", subclass: "footway" }))).toBe("footway");
  });

  it("gives every road a unique id and flags sidewalks among footways only", () => {
    const ids = corner.roads.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const byId = new Map(corner.roads.map((r) => [r.id, r]));
    for (const id of corner.sidewalkIds) expect(byId.get(id)?.cls).toBe("footway");
  });
});

describe("contextFromTiles: across a tile edge", () => {
  it("never leaves two road fragments on top of each other", () => {
    expect(overlappingSegments(edge.roads)).toEqual([]);
  });

  it("would overlap without the clip to the tile bounds (so the check above is not vacuous)", () => {
    const raw = contextFromTiles([...unclipped(SOUTH_TILE), ...unclipped(NORTH_TILE)], createProjection(ON_TILE_EDGE), RADIUS);
    expect(overlappingSegments(raw.roads).length).toBeGreaterThan(0);
  });

  it("stitches a street cut by the edge back into one polyline", () => {
    // y = 0 is the tile edge; Avenida Acoyte crosses it.
    const acoyte = edge.roads.filter((r) => r.name === "Avenida Acoyte");
    expect(acoyte.some((r) => r.points.some((p) => p[1] > 5) && r.points.some((p) => p[1] < -5))).toBe(true);
    // No two pieces of the same street end on the edge facing each other.
    const uses = new Map<string, number>();
    for (const road of edge.roads) for (const p of road.points) uses.set(vertexKey(p), (uses.get(vertexKey(p)) ?? 0) + 1);
    const endsOnEdge = edge.roads.flatMap((r) =>
      [r.points[0], r.points[r.points.length - 1]].filter((p) => Math.abs(p[1]) < 0.01).map((p) => ({ road: r, key: vertexKey(p) })),
    );
    const seams = endsOnEdge.filter(({ road, key }) =>
      endsOnEdge.some((o) => o.road !== road && o.key === key && o.road.cls === road.cls && o.road.name === road.name && uses.get(key) === 2),
    );
    expect(seams).toEqual([]);
  });

  it("never leaves overlapping park or building surfaces", () => {
    expect(maxPairwiseOverlap(edge.parks.map((p) => p.polygon))).toBeLessThan(0.5);
    expect(maxPairwiseOverlap(edge.fallbackBuildings.map((b) => b.footprint))).toBeLessThan(0.5);
  });

  it("builds the same model whatever the order of tiles and features", () => {
    const shuffled = contextFromTiles([...northFeatures, ...southFeatures].reverse(), createProjection(ON_TILE_EDGE), RADIUS);
    expect(shuffled).toEqual(edge);
  });
});

describe("contextFromTiles: parks and POIs", () => {
  it("finds the parks around Primera Junta, named from the park POI inside them", () => {
    expect(corner.parks.length).toBeGreaterThan(0);
    expect(corner.parks.map((p) => p.name)).toContain("Parque Rivadavia");
    for (const park of corner.parks) {
      expect(park.polygon.length).toBeGreaterThanOrEqual(3);
      expect(park.polygon.every((p) => Math.hypot(p[0], p[1]) <= CLIP_RADIUS + 0.01)).toBe(true);
    }
    expect(maxPairwiseOverlap(corner.parks.map((p) => p.polygon))).toBeLessThan(0.5);
  });

  it("lists named POIs within the radius, closest first", () => {
    const classes = new Set(corner.pois.map((p) => p.class));
    expect(classes).toContain("cafe");
    expect(classes).toContain("shop");
    expect(corner.pois.every((p) => p.name.length > 0 && Math.hypot(...p.position) <= RADIUS)).toBe(true);
    const distances = corner.pois.map((p) => Math.hypot(...p.position));
    expect(distances).toEqual(distances.slice().sort((a, b) => a - b));
  });
});

describe("contextFromTiles: fallback buildings", () => {
  it("keeps the closest 3·MAX_BUILDINGS single-part buildings, closest first", () => {
    const buildings = corner.fallbackBuildings;
    expect(buildings).toHaveLength(3 * MAX_BUILDINGS);
    const distances = buildings.map((b) => b.distance);
    expect(distances).toEqual(distances.slice().sort((a, b) => a - b));
    for (const b of buildings) {
      expect(b.parts).toEqual([{ footprint: b.footprint, height: b.height }]);
      expect(b.height).toBeGreaterThan(0);
      expect(b.smp).toBeUndefined();
    }
    expect(new Set(buildings.map((b) => b.id)).size).toBe(buildings.length);
  });

  it("trusts render_height only when OpenMapTiles did not default it", () => {
    const sources = new Set(edge.fallbackBuildings.map((b) => b.heightSource));
    expect(sources).toEqual(new Set(["osm", "estimated"]));
    for (const b of edge.fallbackBuildings.filter((x) => x.heightSource === "osm")) expect(b.height).not.toBe(DEFAULT_RENDER_HEIGHT);
  });
});

it("is deterministic", () => {
  expect(contextFromTiles(southFeatures, createProjection(ACOYTE_Y_RIVADAVIA), RADIUS)).toEqual(corner);
});
