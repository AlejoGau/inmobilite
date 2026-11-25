import { describe, expect, it } from "vitest";
import fixture from "@/domain/__fixtures__/acoyte-rivadavia.overpass.json";
import { BUILDING_SEARCH_RADIUS, DEFAULT_AREA_RADIUS, type OverpassResponse } from "@/domain/osm/overpass";
import { isParkTags } from "@/domain/area/parks";
import { ROAD_CLIP_MARGIN } from "@/domain/area/roads";
import { createProjection } from "@/domain/geo/projection";
import { closestPointOnPolyline } from "@/domain/geo/polyline";
import { FALLBACK_MAX_DISTANCE_M, FIXTURE_ORIGIN, isNearFixture } from "./offlineFallback";

const FIXTURE = fixture as unknown as OverpassResponse;

/**
 * How far from the fixture origin the fixture has data, per kind: the distance to the closest point of
 * its farthest element. Overpass takes a way whole as soon as one segment is in range, so this is the
 * radius the fixture was fetched with. The far vertices of long avenues (1.4 km) are not coverage.
 */
function measureCoverage(osm: OverpassResponse): { context: number; buildings: number } {
  const projection = createProjection(FIXTURE_ORIGIN);
  const coverage = { context: 0, buildings: 0 };
  for (const el of osm.elements) {
    const tags = el.tags ?? {};
    let kind: keyof typeof coverage | null = null;
    let reach = 0;
    if (el.type === "node" && tags.natural === "tree") {
      kind = "context";
      reach = Math.hypot(...projection.toLocal(el.lon, el.lat));
    } else if (el.type === "way") {
      kind = tags.building ? "buildings" : tags.highway || isParkTags(tags) ? "context" : null;
      const points = el.geometry.map((p) => projection.toLocal(p.lon, p.lat));
      reach = closestPointOnPolyline([0, 0], points).distance;
    }
    if (kind) coverage[kind] = Math.max(coverage[kind], reach);
  }
  return coverage;
}

describe("offline fallback", () => {
  const coverage = measureCoverage(FIXTURE);

  it("only serves origins whose whole area lies inside the fixture's data", () => {
    // Roads and parks are clipped DEFAULT_AREA_RADIUS + ROAD_CLIP_MARGIN out, buildings searched BUILDING_SEARCH_RADIUS out.
    expect(FALLBACK_MAX_DISTANCE_M + DEFAULT_AREA_RADIUS + ROAD_CLIP_MARGIN).toBeLessThanOrEqual(coverage.context);
    expect(FALLBACK_MAX_DISTANCE_M + BUILDING_SEARCH_RADIUS).toBeLessThanOrEqual(coverage.buildings);
  });

  it("still covers the corners next to the demo corner", () => {
    expect(FALLBACK_MAX_DISTANCE_M).toBeGreaterThanOrEqual(150);
    expect(isNearFixture(FIXTURE_ORIGIN)).toBe(true);
    expect(isNearFixture({ lat: -34.617078, lng: -58.437091 })).toBe(true); // Av. Acoyte y Yerbal, ~148 m (USIG)
  });

  it("refuses Rivadavia y Campichuelo, whose scene the fixture would cut on one side", () => {
    expect(isNearFixture({ lat: -34.616703, lng: -58.432864 })).toBe(false); // ~375 m (USIG)
  });
});
