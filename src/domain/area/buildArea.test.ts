import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/acoyte-rivadavia.overpass.json";
import type { OverpassResponse, OverpassWay } from "../osm/overpass";
import { MAX_BUILDINGS, type AreaModel } from "../types";
import { createProjection } from "../geo/projection";
import { centroid, normalizeRing, pointInRing, polygonArea, signedArea } from "../geo/polygon";
import { distance } from "../geo/vec";
import { buildArea } from "./buildArea";
import { LEVEL_HEIGHT, LEVEL_RANGES, COMMERCIAL_GROUND_FLOOR_BONUS } from "./buildingHeight";
import { MIN_BUILDING_AREA } from "./buildings";
import { MAX_LABELS } from "./labels";
import { MAX_TREES, TREE_SCALE_RANGE } from "./trees";
import { ROAD_CLIP_MARGIN } from "./roads";

const ORIGIN = { lat: -34.6183, lng: -58.43646 };
const OSM = fixture as OverpassResponse;
const build = (): AreaModel => buildArea({ origin: ORIGIN, osm: OSM });

describe("buildArea (Acoyte y Rivadavia fixture)", () => {
  const model = build();

  it("is deterministic", () => {
    expect(build()).toEqual(model);
  });

  it("does not depend on the element order of the response", () => {
    const reversed: OverpassResponse = { ...OSM, elements: [...OSM.elements].reverse() };
    expect(buildArea({ origin: ORIGIN, osm: reversed })).toEqual(model);
  });

  it("serialises to plain JSON without losing anything", () => {
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it("runs in under 300 ms", () => {
    const start = performance.now();
    build();
    expect(performance.now() - start).toBeLessThan(300);
  });

  it("keeps at most MAX_BUILDINGS, and they are the closest valid ones", () => {
    expect(model.buildings.length).toBe(MAX_BUILDINGS);
    expect(model.stats.buildings).toBe(model.buildings.length);

    const projection = createProjection(ORIGIN);
    const allDistances = OSM.elements
      .filter((e): e is OverpassWay => e.type === "way" && Boolean(e.tags?.building))
      .map((w) => normalizeRing(w.geometry.map((p) => projection.toLocal(p.lon, p.lat))))
      .filter((r) => r !== null && polygonArea(r) >= MIN_BUILDING_AREA)
      .map((r) => Math.hypot(...centroid(r!)))
      .sort((a, b) => a - b);

    const farthestKept = Math.max(...model.buildings.map((b) => b.distance));
    expect(farthestKept).toBeCloseTo(allDistances[MAX_BUILDINGS - 1], 2);
    const sorted = [...model.buildings].sort((a, b) => a.distance - b.distance);
    expect(model.buildings).toEqual(sorted);
  });

  it("gives every ring CCW orientation and no closing point", () => {
    const rings = [...model.buildings.map((b) => b.footprint), ...model.parks.map((p) => p.polygon)];
    expect(rings.length).toBeGreaterThan(MAX_BUILDINGS);
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(3);
      expect(signedArea(ring)).toBeGreaterThan(0);
      expect(distance(ring[0], ring[ring.length - 1])).toBeGreaterThan(0.05);
    }
  });

  it("gives buildings sane metadata", () => {
    for (const b of model.buildings) {
      expect(b.area).toBeGreaterThanOrEqual(MIN_BUILDING_AREA);
      expect(b.distance).toBeCloseTo(Math.hypot(...centroid(b.footprint)), 1);
      expect(b.id).toMatch(/^way\/\d+$/);
      expect(Number.isInteger(b.seed)).toBe(true);
    }
    expect(model.stats.estimatedHeights).toBe(model.buildings.filter((b) => b.heightSource === "estimated").length);
    expect(model.buildings.some((b) => b.name)).toBe(true);
  });

  it("keeps heights within Buenos Aires-plausible ranges", () => {
    const [minAll, maxAll] = [
      Math.min(...Object.values(LEVEL_RANGES).map((r) => r[0])),
      Math.max(...Object.values(LEVEL_RANGES).map((r) => r[1])),
    ];
    for (const b of model.buildings) {
      expect(b.height).toBeGreaterThanOrEqual(2);
      if (b.heightSource === "osm") continue;
      expect(b.levels).toBeGreaterThanOrEqual(minAll);
      expect(b.levels).toBeLessThanOrEqual(maxAll);
      if (b.use === "commercial") expect(b.levels).toBeLessThanOrEqual(LEVEL_RANGES.largeCommercial[1]);
      if (b.use === "civic") expect(b.levels).toBeLessThanOrEqual(LEVEL_RANGES.civic[1]);
      const bonus = b.use === "commercial" ? COMMERCIAL_GROUND_FLOOR_BONUS : 0;
      expect(b.height).toBeCloseTo(b.levels * LEVEL_HEIGHT + bonus, 5);
    }
  });

  it("finds Acoyte and Rivadavia among the closest streets and first labels", () => {
    const firstStreets = model.stats.streets.slice(0, 3);
    expect(firstStreets).toEqual(expect.arrayContaining(["Avenida Acoyte", "Avenida Rivadavia"]));
    const firstLabels = model.labels.slice(0, 3).map((l) => l.name);
    expect(firstLabels).toEqual(expect.arrayContaining(["Avenida Acoyte", "Avenida Rivadavia"]));
    expect(new Set(model.stats.streets).size).toBe(model.stats.streets.length);
  });

  it("writes readable labels that do not overlap at the corner", () => {
    expect(model.labels.length).toBeLessThanOrEqual(MAX_LABELS);
    for (const label of model.labels) {
      expect(label.angle).toBeGreaterThan(-Math.PI / 2);
      expect(label.angle).toBeLessThanOrEqual(Math.PI / 2);
    }
    const [a, b] = model.labels;
    expect(distance(a.position, b.position)).toBeGreaterThan(10);
  });

  it("maps roads to known classes and clips them to the radius", () => {
    expect(model.roads.length).toBeGreaterThan(20);
    const limit = model.radius + ROAD_CLIP_MARGIN + 1e-3;
    for (const road of model.roads) {
      expect(road.points.length).toBeGreaterThanOrEqual(2);
      for (const p of road.points) expect(Math.hypot(...p)).toBeLessThanOrEqual(limit);
    }
    const rivadavia = model.roads.find((r) => r.name === "Avenida Rivadavia");
    expect(rivadavia?.cls).toBe("primary");
    expect(rivadavia?.width).toBe(18);
    expect(model.roads.some((r) => r.name === "Avenida Acoyte" && r.cls === "secondary")).toBe(true);
  });

  it("places trees off buildings and roads, within the cap", () => {
    expect(model.trees.length).toBeGreaterThan(100);
    expect(model.trees.length).toBeLessThanOrEqual(MAX_TREES);
    for (const tree of model.trees) {
      expect(tree.scale).toBeGreaterThanOrEqual(TREE_SCALE_RANGE[0]);
      expect(tree.scale).toBeLessThanOrEqual(TREE_SCALE_RANGE[1]);
      expect(Math.hypot(...tree.position)).toBeLessThanOrEqual(model.radius);
      for (const b of model.buildings) expect(pointInRing(tree.position, b.footprint)).toBe(false);
    }
  });

  it("fills parks with some trees", () => {
    expect(model.parks.length).toBeGreaterThan(0);
    const inParks = model.trees.filter((t) => model.parks.some((p) => pointInRing(t.position, p.polygon)));
    expect(inParks.length).toBeGreaterThan(10);
  });

  it("sets seed and attribution", () => {
    expect(model.seed).toBe(buildArea({ origin: { ...ORIGIN }, osm: { elements: [] } }).seed);
    expect(model.attribution).toBe("© OpenStreetMap contributors");
  });

  it("returns an empty but valid model for an empty response", () => {
    const empty = buildArea({ origin: ORIGIN, osm: { elements: [] } });
    expect(empty.buildings).toEqual([]);
    expect(empty.trees).toEqual([]);
    expect(empty.labels).toEqual([]);
    expect(empty.stats).toEqual({ buildings: 0, estimatedHeights: 0, streets: [] });
  });
});
