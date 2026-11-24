import type { LngLat, Vec2 } from "../types";

/** WGS84 equatorial radius, in meters. */
const EARTH_RADIUS = 6378137;
const DEG = Math.PI / 180;

export interface Projection {
  /** Lng/lat to local meters [east, north] around the origin. */
  toLocal(lng: number, lat: number): Vec2;
  toLngLat(v: Vec2): LngLat;
}

/**
 * Equirectangular local tangent plane centred on the origin. Over 1 km the
 * error against a true geodesic is well under a centimetre per metre, which
 * is far below what a city-block scene can show, and it keeps the maths
 * trivially invertible.
 */
export function createProjection(origin: LngLat): Projection {
  const metersPerRadLat = EARTH_RADIUS;
  const metersPerRadLng = EARTH_RADIUS * Math.cos(origin.lat * DEG);

  return {
    toLocal(lng, lat) {
      return [(lng - origin.lng) * DEG * metersPerRadLng, (lat - origin.lat) * DEG * metersPerRadLat];
    },
    toLngLat([x, y]) {
      return {
        lng: origin.lng + x / metersPerRadLng / DEG,
        lat: origin.lat + y / metersPerRadLat / DEG,
      };
    },
  };
}

/**
 * Great-circle distance in meters (haversine). Used where two points are not
 * expressed in the same local plane, e.g. deduping geocoder results.
 */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}
