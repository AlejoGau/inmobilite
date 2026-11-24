import type { LngLat } from "../types";

/**
 * Raw Overpass API types (JSON output of `out geom;`) and the query used by the app.
 * Contract shared by the HTTP client (infra) and the area builder (domain).
 */

export interface OverpassLatLon {
  lat: number;
  lon: number;
}

export interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OverpassWay {
  type: "way";
  id: number;
  /** Node ids, in order. Shared between ways, so streets can be joined into a graph. */
  nodes: number[];
  /** Same length and order as `nodes`. */
  geometry: OverpassLatLon[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
}

export type OverpassElement = OverpassNode | OverpassWay;

export interface OverpassResponse {
  version?: number;
  generator?: string;
  elements: OverpassElement[];
}

/** Radius of the street, park and tree context, in meters. */
export const DEFAULT_AREA_RADIUS = 300;

/**
 * Buildings are searched within this radius. Only the MAX_BUILDINGS closest
 * ones are kept, so the payload stays small.
 */
export const BUILDING_SEARCH_RADIUS = 160;

/** Builds the Overpass QL query for an area. */
export function buildOverpassQuery(origin: LngLat, radius: number = DEFAULT_AREA_RADIUS): string {
  const lat = origin.lat.toFixed(6);
  const lng = origin.lng.toFixed(6);
  const r = Math.round(radius);
  const rb = Math.round(Math.min(BUILDING_SEARCH_RADIUS, radius));
  return (
    `[out:json][timeout:25];(` +
    `way["building"](around:${rb},${lat},${lng});` +
    `way["highway"](around:${r},${lat},${lng});` +
    `way["leisure"~"^(park|garden|playground)$"](around:${r},${lat},${lng});` +
    `way["landuse"~"^(grass|recreation_ground)$"](around:${r},${lat},${lng});` +
    `node["natural"="tree"](around:${r},${lat},${lng});` +
    `);out geom;`
  );
}
