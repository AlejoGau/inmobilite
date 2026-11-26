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

export interface OverpassMember {
  type: "node" | "way" | "relation";
  ref: number;
  /** "outer" or "inner" in a multipolygon. Old-style multipolygons may leave it empty. */
  role: string;
  /** Way members only (`out geom` emits it), in order. Absent when Overpass could not resolve every point. */
  geometry?: OverpassLatLon[];
}

/**
 * A multipolygon relation: the outline of a landmark mapped with holes or a split outer ring (Plaza de
 * Mayo, Palacio de Aguas Corrientes). The tags live on the relation; its member ways are usually untagged.
 */
export interface OverpassRelation {
  type: "relation";
  id: number;
  members: OverpassMember[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
}

export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

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

/**
 * Server-side limit for the query, in seconds. Below the client's overall budget (OVERPASS_BUDGET_MS
 * in infra), so a mirror never keeps computing an answer nobody waits for. A low value also makes a
 * busy server more likely to accept the query: Overpass admits queries by their declared timeout.
 */
export const OVERPASS_QUERY_TIMEOUT_S = 8;

/** Builds the Overpass QL query for an area. */
export function buildOverpassQuery(origin: LngLat, radius: number = DEFAULT_AREA_RADIUS): string {
  const lat = origin.lat.toFixed(6);
  const lng = origin.lng.toFixed(6);
  const r = Math.round(radius);
  const rb = Math.round(Math.min(BUILDING_SEARCH_RADIUS, radius));
  const near = `(around:${r},${lat},${lng});`;
  const nearBuildings = `(around:${rb},${lat},${lng});`;
  // Buildings and parks come as closed ways and as multipolygon relations; `out geom` gives the
  // relations' member geometry, from which the domain assembles their outlines.
  const multipolygon = `["type"="multipolygon"]`;
  const parkLeisure = `["leisure"~"^(park|garden|playground)$"]`;
  const parkLanduse = `["landuse"~"^(grass|recreation_ground)$"]`;
  return (
    `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];(` +
    `way["building"]${nearBuildings}` +
    `relation["building"]${multipolygon}${nearBuildings}` +
    `way["highway"]${near}` +
    `way${parkLeisure}${near}` +
    `relation${parkLeisure}${multipolygon}${near}` +
    `way${parkLanduse}${near}` +
    `relation${parkLanduse}${multipolygon}${near}` +
    `node["natural"="tree"]${near}` +
    `);out geom;`
  );
}

/** Server-side limit for the complement query: the caller only waits about this long anyway. */
export const COMPLEMENT_QUERY_TIMEOUT_S = 3;

/**
 * The light query that complements the tiles: the vector tiles have no trees
 * and no building names, Overpass does. Only named buildings, and no
 * relations, so the answer stays small and fast even on a busy mirror.
 */
export function buildComplementQuery(origin: LngLat, radius: number = DEFAULT_AREA_RADIUS): string {
  const lat = origin.lat.toFixed(6);
  const lng = origin.lng.toFixed(6);
  const r = Math.round(radius);
  const rb = Math.round(Math.min(BUILDING_SEARCH_RADIUS, radius));
  return (
    `[out:json][timeout:${COMPLEMENT_QUERY_TIMEOUT_S}];(` +
    `node["natural"="tree"](around:${r},${lat},${lng});` +
    `way["building"]["name"](around:${rb},${lat},${lng});` +
    `);out geom;`
  );
}
