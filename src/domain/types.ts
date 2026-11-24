/**
 * Shared contract between domain, API routes and the 3D scene.
 *
 * Coordinates: the domain works in a local tangent plane in METERS around the
 * area origin. `Vec2 = [x, y]` with x = east and y = north. The scene maps it
 * to three.js as (x, height, -y), so north points to -Z.
 *
 * Everything here is plain serialisable data: it travels as JSON from
 * `/api/area` to the browser, and it must stay deterministic. The same
 * origin always yields the same model, so there are no timestamps or
 * randomness without a seed.
 */

export type LngLat = { lng: number; lat: number };

/** Local planar point in meters: [east, north]. */
export type Vec2 = [number, number];

/** Closed ring WITHOUT the repeated last point, counter-clockwise. */
export type Ring = Vec2[];

// ---------------------------------------------------------------- geocoding

export type GeocodeProvider = "usig" | "georef" | "photon";

export type GeocodeKind = "intersection" | "address" | "street" | "place";

export interface GeocodeResult {
  /** Stable id: `${provider}:${something stable}`. */
  id: string;
  /** Main line, human friendly: "Av. Acoyte y Av. Rivadavia". */
  label: string;
  /** Second line: "Caballito, CABA". */
  secondary?: string;
  lat: number;
  lng: number;
  kind: GeocodeKind;
  provider: GeocodeProvider;
}

export interface GeocodeResponse {
  query: string;
  results: GeocodeResult[];
}

// ---------------------------------------------------------------- area model

export type RoadClass =
  | "primary"
  | "secondary"
  | "tertiary"
  | "residential"
  | "service"
  | "pedestrian"
  | "footway";

export interface Road {
  id: string;
  name?: string;
  cls: RoadClass;
  /** Carriageway width in meters (sidewalks not included). */
  width: number;
  /** Polyline in local meters. */
  points: Vec2[];
}

export type BuildingUse = "residential" | "commercial" | "civic" | "other";

/** At most this many buildings are modelled: the ones closest to the origin. */
export const MAX_BUILDINGS = 20;

export interface Building {
  id: string;
  /** Name from OSM, if any ("Banco Ciudad", "Yenny"). */
  name?: string;
  /** Real OpenStreetMap footprint, in local meters. */
  footprint: Ring;
  /** Total height in meters. */
  height: number;
  levels: number;
  /** "osm" = building:levels/height tag. "estimated" = deterministic estimate from use and footprint area. */
  heightSource: "osm" | "estimated";
  use: BuildingUse;
  /** Footprint area in m². */
  area: number;
  /** Distance from the footprint centroid to the origin, in meters. The director uses it for the stagger. */
  distance: number;
  /** Per-building deterministic seed, for colour or material variation. */
  seed: number;
}

export interface Park {
  id: string;
  name?: string;
  polygon: Ring;
}

export interface Tree {
  position: Vec2;
  /** 0.7 to 1.3. */
  scale: number;
}

export interface StreetLabel {
  name: string;
  /** Anchor point on the street, near the origin. */
  position: Vec2;
  /** Radians, the direction of the street at the anchor (0 = east, CCW). */
  angle: number;
}

export interface AreaStats {
  /** Buildings modelled (at most MAX_BUILDINGS). */
  buildings: number;
  /** How many of them have an estimated height. */
  estimatedHeights: number;
  /** Unique street names within the radius, closest first. */
  streets: string[];
}

export interface AreaModel {
  origin: LngLat;
  /** Radius covered, in meters. */
  radius: number;
  /** Seed derived from the origin (see domain/seed.ts). */
  seed: number;
  roads: Road[];
  buildings: Building[];
  parks: Park[];
  trees: Tree[];
  labels: StreetLabel[];
  stats: AreaStats;
  attribution: string;
}

export interface AreaErrorResponse {
  error: string;
}
