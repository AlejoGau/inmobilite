import { difference } from "@turf/difference";
import { intersect } from "@turf/intersect";
import { union } from "@turf/union";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { Projection } from "../geo/projection";
import { centroid, normalizeRing, polygonArea } from "../geo/polygon";
import { length, round3, roundVec } from "../geo/vec";
import { hashString } from "../seed";
import { MAX_BUILDINGS, type Building, type BuildingPart, type LngLat, type Ring, type Vec2 } from "../types";

/**
 * Buildings from the GCBA "Tejido Urbano" 3D city model: measured volumes,
 * not estimates. Each tile feature is one PIECE of a cadastral parcel (smp):
 * a footprint with one roof height. The pieces of a parcel tile the lot side
 * by side, so a podium plus a tower is short pieces next to tall ones, and
 * each piece maps onto a BuildingPart (a prism from the ground).
 */

/** A [lng, lat] position. */
export type LngLatPosition = [number, number];

/**
 * One piece as the infra layer delivers it. Its rings are already clipped to
 * the tile they came from, so fragments of a piece that crosses a tile edge
 * abut instead of overlapping, and they have no holes (holed pieces are cut
 * into hole-free fragments, because a BuildingPart cannot carry a hole).
 */
export interface TejidoPiece {
  /** The GCBA piece id (the feature's `id` property). Shared by the fragments of one piece. */
  pieceId: number;
  /** Cadastral parcel, sección-manzana-parcela, e.g. "040-088-009D". */
  smp: string;
  /** Roof height above the ground, in meters (`altura`). 0 means a void or a patio. */
  height: number;
  /** Outer rings in lng/lat, without the repeated closing point. */
  rings: LngLatPosition[][];
}

/** Fragments smaller than this (m²) are clipping or photogrammetry noise, not volumes. */
export const MIN_PART_AREA = 2;
/** The GCBA model counts floors in 2.8 m steps. */
export const GCBA_LEVEL_HEIGHT = 2.8;
/**
 * Exact footprints need polygon unions per parcel, which is too slow for the
 * ~1000 parcels of six tiles. A cheap centroid ranks them first; only this
 * many times MAX_BUILDINGS go through the exact pass. The two rankings only
 * diverge for parcels with holes or detached islands, never by a factor.
 */
const CANDIDATE_FACTOR = 3;
/**
 * Overlaps below this (m²) are the few centimetres of photogrammetry noise
 * along a shared wall: invisible, and cutting them would only add vertices.
 */
const OVERLAP_TOLERANCE = 0.05;

interface PieceRing {
  pieceId: number;
  height: number;
  ring: Ring;
}

interface Parcel {
  smp: string;
  fragments: PieceRing[];
  /** Distance from the origin to the area-weighted centroid of the fragments: a cheap pre-ranking. */
  roughDistance: number;
}

/**
 * The MAX_BUILDINGS parcels closest to the origin, as multi-part buildings.
 * Pure and deterministic: the same pieces always give the same buildings, in
 * the same order (distance, then smp), whatever order the tiles came in.
 */
export function buildingsFromTejido(pieces: readonly TejidoPiece[], projection: Projection, origin: LngLat): Building[] {
  // Projected too, so a caller whose projection is centred elsewhere still gets distances from `origin`.
  const center = projection.toLocal(origin.lng, origin.lat);
  const parcels = groupByParcel(pieces, projection, center);

  const candidates = [...parcels.values()]
    .sort((a, b) => a.roughDistance - b.roughDistance || compareStrings(a.smp, b.smp))
    .slice(0, MAX_BUILDINGS * CANDIDATE_FACTOR);

  return candidates
    .map((parcel) => outlineParcel(parcel, center))
    .sort((a, b) => a.distance - b.distance || compareStrings(a.smp, b.smp))
    .slice(0, MAX_BUILDINGS)
    .map(toBuilding);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupByParcel(pieces: readonly TejidoPiece[], projection: Projection, center: Vec2): Map<string, Parcel> {
  const fragmentsBySmp = new Map<string, PieceRing[]>();
  for (const piece of pieces) {
    if (!(piece.height > 0) || !piece.smp) continue;
    for (const raw of piece.rings) {
      // Rounded before normalising: fragments that share an edge come from the same tile
      // coordinates, so they round to the same millimetre and keep abutting exactly.
      const ring = normalizeRing(raw.map(([lng, lat]) => roundVec(projection.toLocal(lng, lat))));
      if (!ring || polygonArea(ring) < MIN_PART_AREA) continue;
      const list = fragmentsBySmp.get(piece.smp) ?? [];
      list.push({ pieceId: piece.pieceId, height: piece.height, ring });
      fragmentsBySmp.set(piece.smp, list);
    }
  }

  const parcels = new Map<string, Parcel>();
  for (const [smp, fragments] of fragmentsBySmp) {
    parcels.set(smp, { smp, fragments, roughDistance: distanceFrom(center, weightedCentroid(fragments)) });
  }
  return parcels;
}

function weightedCentroid(fragments: readonly PieceRing[]): Vec2 {
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (const f of fragments) {
    const c = centroid(f.ring);
    const area = polygonArea(f.ring);
    sx += c[0] * area;
    sy += c[1] * area;
    total += area;
  }
  return [sx / total, sy / total];
}

function distanceFrom(center: Vec2, p: Vec2): number {
  return length([p[0] - center[0], p[1] - center[1]]);
}

interface OutlinedParcel {
  smp: string;
  pieces: PieceRing[];
  footprint: Ring;
  distance: number;
}

/**
 * The exact outline and distance, before overlaps are resolved: cutting the
 * lower of two overlapping pieces never changes their union, so the ranking
 * can be settled first and the (pairwise, slower) overlap pass only runs for
 * the parcels that make the cut.
 */
function outlineParcel(parcel: Parcel, center: Vec2): OutlinedParcel {
  // A canonical order first: boolean operations may start their rings at another vertex when
  // fed the same polygons in another order, and the output must not depend on tile order.
  const fragments = [...parcel.fragments].sort(comparePieceRings);
  const pieces = weldPieces(fragments);
  const footprint = outlineOf(pieces.map((p) => p.ring));
  return { smp: parcel.smp, pieces, footprint, distance: round3(distanceFrom(center, centroid(footprint))) };
}

function toBuilding({ smp, pieces, footprint, distance }: OutlinedParcel): Building {
  const resolved = resolveOverlaps(pieces).sort(comparePieceRings);
  const parts: BuildingPart[] = resolved.map((p) => ({ footprint: p.ring, height: p.height }));
  const height = Math.max(...parts.map((p) => p.height));
  const id = `gcba:${smp}`;
  return {
    id,
    footprint,
    parts,
    height,
    levels: Math.max(1, Math.round(height / GCBA_LEVEL_HEIGHT)),
    heightSource: "gcba",
    smp,
    // The compose stage refines the use from nearby POIs; the volume data carries none.
    use: "residential",
    area: Math.round(parts.reduce((sum, p) => sum + polygonArea(p.footprint), 0) * 10) / 10,
    distance,
    seed: hashString(id),
  };
}

function comparePieceRings(a: PieceRing, b: PieceRing): number {
  return a.pieceId - b.pieceId || a.height - b.height || compareRings(a.ring, b.ring);
}

function compareRings(a: Ring, b: Ring): number {
  const ca = centroid(a);
  const cb = centroid(b);
  return ca[0] - cb[0] || ca[1] - cb[1];
}

/**
 * One part per piece where possible. A piece that crossed a tile edge arrives
 * as abutting fragments; welding them back removes a wall that would stand
 * inside the volume. Fragments only merge when the result is one simple
 * polygon: a holed piece was cut on purpose, and re-merging it would bring
 * the hole back.
 */
function weldPieces(fragments: readonly PieceRing[]): PieceRing[] {
  const groups = new Map<string, PieceRing[]>();
  for (const f of fragments) {
    const key = `${f.pieceId}|${f.height}`;
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  const welded: PieceRing[] = [];
  for (const group of groups.values()) {
    const merged = group.length > 1 ? simplePolygonOf(unionRings(group.map((f) => f.ring))) : null;
    if (merged) welded.push({ pieceId: group[0].pieceId, height: group[0].height, ring: merged });
    else welded.push(...group);
  }
  return welded;
}

/**
 * The GCBA data sometimes has a piece lying on top of another of the same
 * parcel (a 22.4 m block drawn inside another 22.4 m block). Coplanar roofs
 * and walls would z-fight, so the taller piece keeps the contested ground
 * and the lower one is cut around it: a hidden piece disappears, and a
 * tower drawn inside a podium leaves a hole that is cut open (removeHoles).
 */
function resolveOverlaps(pieces: readonly PieceRing[]): PieceRing[] {
  const claimOrder = [...pieces].sort((a, b) => b.height - a.height || a.pieceId - b.pieceId || compareRings(a.ring, b.ring));
  const accepted: PieceRing[] = [];
  for (const piece of claimOrder) {
    const blockers = accepted.filter((other) => overlapArea(piece.ring, other.ring) > OVERLAP_TOLERANCE);
    if (blockers.length === 0) {
      accepted.push(piece);
      continue;
    }
    for (const ring of subtractRings(piece.ring, blockers.map((b) => b.ring))) {
      accepted.push({ pieceId: piece.pieceId, height: piece.height, ring });
    }
  }
  return accepted;
}

function overlapArea(a: Ring, b: Ring): number {
  if (!boxesOverlap(boxOf(a), boxOf(b))) return 0;
  const shared = safely(() => intersect(featureCollection([toTurf(a), toTurf(b)])));
  return shared ? polygonsOfFeature(shared).reduce((sum, poly) => sum + polygonArea(toVecs(poly[0])), 0) : 0;
}

function subtractRings(ring: Ring, cutters: readonly Ring[]): Ring[] {
  let rest: Feature<Polygon | MultiPolygon> | null;
  try {
    rest = difference(featureCollection([toTurf(ring), ...cutters.map(toTurf)]));
  } catch {
    // Better a little z-fighting than a missing volume.
    return [ring];
  }
  // Null means the taller pieces cover this one completely: it was hidden anyway.
  if (!rest) return [];
  return polygonsOfFeature(rest)
    .flatMap((poly) => removeHoles(poly))
    .map((poly) => normalizeRing(toVecs(poly[0]).map(roundVec)))
    .filter((r): r is Ring => r !== null && polygonArea(r) >= MIN_PART_AREA);
}

/**
 * The building outline: the outer ring of the union of its parts. Inner
 * courtyards are not part of the contract; when the parts form several
 * islands (a parcel split by a passage), the largest one stands for it.
 */
function outlineOf(rings: readonly Ring[]): Ring {
  const largest = rings.reduce((best, r) => (polygonArea(r) > polygonArea(best) ? r : best));
  if (rings.length === 1) return largest;
  const merged = unionRings(rings);
  let best: Ring | null = null;
  for (const poly of merged ? polygonsOfFeature(merged) : []) {
    const ring = normalizeRing(toVecs(poly[0]).map(roundVec));
    if (ring && (best === null || polygonArea(ring) > polygonArea(best))) best = ring;
  }
  return best ?? largest;
}

/** The union as one ring when it is a single polygon without holes; null otherwise. */
function simplePolygonOf(feature: Feature<Polygon | MultiPolygon> | null): Ring | null {
  if (!feature || feature.geometry.type !== "Polygon" || feature.geometry.coordinates.length !== 1) return null;
  return normalizeRing(toVecs(feature.geometry.coordinates[0]).map(roundVec));
}

/**
 * Planar union through turf (polyclip). Turf's boolean operations are planar,
 * so local meters are exact enough here, and better conditioned than degrees.
 */
function unionRings(rings: readonly Ring[]): Feature<Polygon | MultiPolygon> | null {
  return safely(() => union(featureCollection(rings.map(toTurf))));
}

/** polyclip can throw on degenerate input; every caller has a sensible fallback for null. */
function safely<T>(op: () => T | null): T | null {
  try {
    return op();
  } catch {
    return null;
  }
}

function toTurf(ring: Ring): Feature<Polygon> {
  return turfPolygon([[...ring, ring[0]]]);
}

function toVecs(ring: Position[]): Vec2[] {
  return ring.map((p) => [p[0], p[1]]);
}

function polygonsOfFeature(feature: Feature<Polygon | MultiPolygon>): PolygonCoordinates[] {
  return feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

// ---------------------------------------------------------------- planar polygon helpers
//
// Shared with the infra tile reader, which runs them on lng/lat (the maths
// are planar, so any x/y works). They live here because the domain cannot
// import from infra.

/** A polygon as GeoJSON coordinates: an outer ring, then its holes. Rings are closed. */
export type PolygonCoordinates = Position[][];

/** An axis-aligned box. For lng/lat, x is the longitude and y the latitude. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Far more cuts than any real piece needs (the busiest has a handful of holes). */
const MAX_HOLE_CUTS = 16;

export function boxOf(ring: readonly (Position | Vec2)[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/**
 * The part of a polygon inside a box, as zero or more polygons. Invalid
 * input (a self-touching ring, say) can make polyclip throw; one malformed
 * feature must not sink the whole area, so it yields nothing.
 */
export function clipToBox(polygon: PolygonCoordinates, b: Box): PolygonCoordinates[] {
  const box = turfPolygon([
    [
      [b.minX, b.minY],
      [b.maxX, b.minY],
      [b.maxX, b.maxY],
      [b.minX, b.maxY],
      [b.minX, b.minY],
    ],
  ]);
  const result = safely(() => intersect(featureCollection([turfPolygon(polygon), box])));
  return result ? polygonsOfFeature(result) : [];
}

/**
 * Cuts a holed polygon into hole-free pieces. A building part is a prism on
 * one outer ring, so a hole (a light well, a patio) cannot be represented;
 * extruding the outer ring alone would fill the patio and overlap whatever
 * stands inside it. A vertical cut through the middle of a hole opens it in
 * both halves, and the recursion repeats until no hole is left.
 */
export function removeHoles(polygon: PolygonCoordinates, depth = 0): PolygonCoordinates[] {
  if (polygon.length <= 1) return [polygon];
  // A degenerate (zero-width) hole cannot be opened by a cut; past a sane depth, keep the outer ring.
  if (depth >= MAX_HOLE_CUTS) return [[polygon[0]]];
  const hole = boxOf(polygon[1]);
  const outer = boxOf(polygon[0]);
  const cut = (hole.minX + hole.maxX) / 2;
  const halves = [...clipToBox(polygon, { ...outer, maxX: cut }), ...clipToBox(polygon, { ...outer, minX: cut })];
  // The cut crosses the hole, so each half has fewer holes than its parent.
  return halves.flatMap((half) => removeHoles(half, depth + 1));
}
