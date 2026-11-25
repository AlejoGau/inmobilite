import type { LngLat } from "@/domain/types";
import { BUILDING_SEARCH_RADIUS, DEFAULT_AREA_RADIUS, type OverpassResponse } from "@/domain/osm/overpass";
import { ROAD_CLIP_MARGIN } from "@/domain/area/roads";
import { haversineMeters } from "@/domain/geo/projection";

/** Origin of the bundled fixture: Av. Acoyte y Av. Rivadavia, Caballito. */
export const FIXTURE_ORIGIN: LngLat = { lat: -34.6183, lng: -58.43646 };

/**
 * Radii the fixture holds data for around its origin, in meters. Measured from the data, not from its
 * far vertices: a long avenue comes whole up to 1.4 km out, but only what is within ~520 m is complete.
 * Roads, parks and trees reach 520 m, buildings 419 m (offlineFallback.test.ts re-measures them).
 */
const FIXTURE_CONTEXT_RADIUS_M = 520;
const FIXTURE_BUILDING_RADIUS_M = 419;

/**
 * An area centred at most this far from the fixture origin lies wholly inside the fixture's data: its
 * roads and parks reach DEFAULT_AREA_RADIUS + ROAD_CLIP_MARGIN out, its buildings BUILDING_SEARCH_RADIUS.
 * Farther out the scene would be cut on one side, so those corners get a 503 instead. 190 m today.
 */
export const FALLBACK_MAX_DISTANCE_M = Math.min(
  FIXTURE_CONTEXT_RADIUS_M - (DEFAULT_AREA_RADIUS + ROAD_CLIP_MARGIN),
  FIXTURE_BUILDING_RADIUS_M - BUILDING_SEARCH_RADIUS,
);

export function isNearFixture(origin: LngLat): boolean {
  return haversineMeters(origin, FIXTURE_ORIGIN) <= FALLBACK_MAX_DISTANCE_M;
}

/**
 * Bundled OSM data for the demo corner, used only when every Overpass mirror
 * fails, so the live demo never breaks. Loaded lazily: it is ~300 KB and the
 * happy path never needs it.
 */
export async function loadOfflineFallback(origin: LngLat): Promise<OverpassResponse | null> {
  if (!isNearFixture(origin)) return null;
  const fixture = await import("@/domain/__fixtures__/acoyte-rivadavia.overpass.json");
  return (fixture.default ?? fixture) as unknown as OverpassResponse;
}
