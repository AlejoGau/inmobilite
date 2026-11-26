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

/**
 * One volume of a building: a prism from the ground up to `height`. A plain
 * block has a single part. A real Buenos Aires building often has several: a
 * podium plus a tower, stepped setbacks, rooftop machine rooms or tanks. The
 * parts of a building tile its lot without overlapping.
 */
export interface BuildingPart {
  /** Footprint of this volume, in local meters. */
  footprint: Ring;
  /** Height of this volume's roof above the ground, in meters. */
  height: number;
}

/**
 * Where a building's height comes from:
 * - "gcba": measured. The Buenos Aires city government's 3D city model
 *   ("Tejido Urbano", photogrammetry), per volume.
 * - "osm": the OpenStreetMap height or building:levels tag.
 * - "estimated": a deterministic estimate from the use and the footprint area.
 */
export type HeightSource = "gcba" | "osm" | "estimated";

export interface Building {
  id: string;
  /** Name, if known ("Banco Ciudad", "Yenny"). */
  name?: string;
  /**
   * Outline of the whole building, in local meters: the outer ring of the
   * union of its parts (inner courtyards are not represented).
   */
  footprint: Ring;
  /** The building's volumes. Always at least one. */
  parts: BuildingPart[];
  /** Height of the tallest part, in meters. */
  height: number;
  levels: number;
  heightSource: HeightSource;
  /** Cadastral parcel (sección-manzana-parcela) when the data comes from the GCBA, e.g. "040-088-009I". */
  smp?: string;
  use: BuildingUse;
  /** Footprint area in m². */
  area: number;
  /** Distance from the footprint centroid to the origin, in meters. The director uses it for the stagger. */
  distance: number;
  /** Per-building deterministic seed, for colour or material variation. */
  seed: number;
  /** Real street-level photo of the facade, only on the featured buildings (see AreaModel.featuredBuildingIds). */
  facade?: FacadePhoto;
}

/**
 * A real photo of a building's street front (GCBA/USIG cadastral photos,
 * street level, 2005-2006). The scene drapes it over `front`.
 */
export interface FacadePhoto {
  /** Image URL, CORS-enabled so the scene can texture with it. */
  url: string;
  /** Date the photo was taken, ISO "YYYY-MM-DD", when known. */
  date?: string;
  /** Credit to show wherever the photo appears. */
  credit: string;
  /**
   * The street-facing wall, in local meters: an edge of the footprint,
   * ordered so the street is on the RIGHT walking from [0] to [1]. Its
   * outward normal is therefore (dy, -dx) / length, and a viewer on the
   * street sees [0] on the left and [1] on the right.
   */
  front: [Vec2, Vec2];
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
  /**
   * The buildings that get the real-facade treatment: the searched property
   * first, then its two nearest neighbours. Absent in models built before it existed.
   */
  featuredBuildingIds?: string[];
}

export interface AreaErrorResponse {
  error: string;
}
