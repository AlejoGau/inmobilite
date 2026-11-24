import type { LngLat } from "@/domain/types";
import type { OverpassResponse } from "@/domain/osm/overpass";
import { haversineMeters } from "@/domain/geo/projection";

/** Origin of the bundled fixture: Av. Acoyte y Av. Rivadavia, Caballito. */
export const FIXTURE_ORIGIN: LngLat = { lat: -34.6183, lng: -58.43646 };
/**
 * The fixture covers about 1.4 km around its origin, so any area of the
 * default radius centred within this distance is fully inside it.
 */
export const FALLBACK_MAX_DISTANCE_M = 400;

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
