import type { LngLat } from "../types";

/** A slippy-map (XYZ, Web Mercator) tile. */
export interface TileId {
  z: number;
  x: number;
  y: number;
}

const EARTH_RADIUS_M = 6_378_137;
/** Web Mercator is undefined at the poles; tile maths clamp to its valid latitude range. */
const MAX_MERCATOR_LAT = 85.051_128_78;

/** Tile column for a longitude at zoom z (may be fractional). */
export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

/** Tile row for a latitude at zoom z (may be fractional). Row 0 is the north edge. */
export function latToTileY(lat: number, z: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

/**
 * Every tile at zoom z that intersects the square around `center` of half-side
 * `radiusM` meters, in a stable order (row by row, west to east). A square is
 * a safe superset of the circle the area uses.
 */
export function tilesCoveringRadius(center: LngLat, radiusM: number, z: number): TileId[] {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
  const last = 2 ** z - 1;
  const clampTile = (t: number) => Math.max(0, Math.min(last, Math.floor(t)));

  const xMin = clampTile(lngToTileX(center.lng - dLng, z));
  const xMax = clampTile(lngToTileX(center.lng + dLng, z));
  // Northern edge has the smaller row number.
  const yMin = clampTile(latToTileY(center.lat + dLat, z));
  const yMax = clampTile(latToTileY(center.lat - dLat, z));

  const tiles: TileId[] = [];
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) tiles.push({ z, x, y });
  }
  return tiles;
}

/** Fills an XYZ URL template such as "https://host/{z}/{x}/{y}.pbf". */
export function tileUrl(template: string, tile: TileId): string {
  return template.replace("{z}", String(tile.z)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
}
