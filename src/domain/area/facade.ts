import { centroid } from "../geo/polygon";
import { closestPointOnPolyline } from "../geo/polyline";
import { distance, length, sub } from "../geo/vec";
import type { AreaModel, Building, FacadePhoto, Road, RoadClass, Vec2 } from "../types";

/**
 * The real-facade treatment: the searched property and its two nearest
 * neighbours get a street-level photo draped over their front wall. Pure
 * functions: the handler fetches the photos, this decides where they go.
 */

/** The GCBA licence asks for the credit wherever the photo appears. */
export const FACADE_CREDIT = "Foto de fachada: GCBA/USIG";
/** How many buildings get a facade photo: the property plus its 2 nearest neighbours. */
export const FEATURED_COUNT = 3;
/**
 * Edges shorter than this are usually chamfers, notches or digitising noise,
 * not the wall a photo was taken of; they only win when nothing longer exists.
 */
export const MIN_FRONT_EDGE_M = 4;

/** Footways and pedestrian streets do not get cadastral photos: the camera car shot from the carriageway. */
const NON_VEHICULAR: ReadonlySet<RoadClass> = new Set(["pedestrian", "footway"]);

/**
 * Canonical SMP (sección-manzana-parcela): every number zero-padded to three
 * digits, letters upper-cased. The reverse geocoder says "45-068-020C", the
 * 3D model and the photo service say "045-068-020C"; both must compare equal.
 */
export function normalizeSmp(raw: string): string | null {
  const parts = raw.trim().toUpperCase().split("-");
  if (parts.length !== 3) return null;
  const out: string[] = [];
  for (const part of parts) {
    const match = /^(\d+)([A-Z]*)$/.exec(part);
    if (!match) return null;
    out.push(match[1].padStart(3, "0") + match[2]);
  }
  return out.join("-");
}

/**
 * The featured buildings, searched property first: the GCBA building whose
 * parcel is `targetSmp` when the reverse geocoder found it among the
 * modelled ones, else the building closest to the origin; then the two
 * buildings nearest to it. Ties break by id, so the choice is stable.
 */
export function pickFeatured(area: Pick<AreaModel, "buildings">, targetSmp: string | null): string[] {
  const { buildings } = area;
  if (buildings.length === 0) return [];
  const wanted = targetSmp ? normalizeSmp(targetSmp) : null;
  const bySmp = wanted ? buildings.find((b) => b.smp !== undefined && normalizeSmp(b.smp) === wanted) : undefined;
  const property = bySmp ?? [...buildings].sort((a, b) => a.distance - b.distance || compareIds(a, b))[0];

  const centre = centroid(property.footprint);
  const neighbours = buildings
    .filter((b) => b.id !== property.id)
    .map((b) => ({ b, d: distance(centre, centroid(b.footprint)) }))
    .sort((x, y) => x.d - y.d || compareIds(x.b, y.b))
    .slice(0, FEATURED_COUNT - 1)
    .map(({ b }) => b.id);
  return [property.id, ...neighbours];
}

function compareIds(a: Building, b: Building): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The wall facing the street: the footprint edge whose midpoint is closest
 * to the kerb of a vehicular road (centreline distance minus half the
 * carriageway, so a wide avenue is not penalised for its width). Returned
 * with the street on its right (see FacadePhoto.front). Null when there is
 * no vehicular road or no usable edge.
 */
export function frontEdge(building: Pick<Building, "footprint">, roads: readonly Road[]): [Vec2, Vec2] | null {
  const ring = building.footprint;
  const vehicular = roads.filter((r) => !NON_VEHICULAR.has(r.cls) && r.points.length >= 2);
  if (ring.length < 3 || vehicular.length === 0) return null;

  const edges: Array<[Vec2, Vec2]> = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (length(sub(b, a)) > 1e-6) edges.push([a, b]);
  }
  const long = edges.filter(([a, b]) => distance(a, b) >= MIN_FRONT_EDGE_M);
  const candidates = long.length > 0 ? long : edges;

  let best: { edge: [Vec2, Vec2]; score: number; toward: Vec2 } | null = null;
  for (const edge of candidates) {
    const mid: Vec2 = [(edge[0][0] + edge[1][0]) / 2, (edge[0][1] + edge[1][1]) / 2];
    for (const road of vehicular) {
      const closest = closestPointOnPolyline(mid, road.points);
      const score = closest.distance - road.width / 2;
      if (!best || score < best.score) best = { edge, score, toward: sub(closest.point, mid) };
    }
  }
  if (!best) return null;

  const [a, b] = best.edge;
  const d = sub(b, a);
  // Right-hand normal (dy, -dx): flip the edge when it points away from the road.
  const facesRoad = d[1] * best.toward[0] - d[0] * best.toward[1] >= 0;
  return facesRoad ? [a, b] : [b, a];
}

/** Outward unit normal of a front edge (the street side, see FacadePhoto.front). */
export function frontNormal([a, b]: readonly [Vec2, Vec2]): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
}

/** A photo found for a parcel, before it is placed on a wall. */
export interface FacadePhotoSource {
  url: string;
  date?: string;
}

/**
 * The model with its featured buildings marked and, for those with a photo
 * (keyed by normalised SMP) and a street-facing wall, the facade attached.
 * Returns a new model; the input is left untouched (it may be cached).
 */
export function withFacades(area: AreaModel, featuredIds: readonly string[], photos: ReadonlyMap<string, FacadePhotoSource>): AreaModel {
  const featured = new Set(featuredIds);
  let attached = 0;
  const buildings = area.buildings.map((b): Building => {
    if (!featured.has(b.id) || !b.smp) return b;
    const smp = normalizeSmp(b.smp);
    const photo = smp ? photos.get(smp) : undefined;
    const front = photo ? frontEdge(b, area.roads) : null;
    if (!photo || !front) return b;
    attached++;
    const facade: FacadePhoto = { url: photo.url, credit: FACADE_CREDIT, front };
    if (photo.date) facade.date = photo.date;
    return { ...b, facade };
  });
  return {
    ...area,
    buildings,
    featuredBuildingIds: [...featuredIds],
    attribution: attached > 0 ? `${area.attribution} · ${FACADE_CREDIT}` : area.attribution,
  };
}

export interface PropertyFront {
  building: Building;
  front: [Vec2, Vec2];
  /** Outward unit normal of the front (toward the street). */
  normal: Vec2;
  /** Midpoint of the front. */
  mid: Vec2;
}

/**
 * The searched property (first featured id) and its street wall: the one its
 * photo hangs on, or else the one facing the nearest road, so the camera and
 * the marker still know where its front is when the photo is missing.
 */
export function propertyFront(area: Pick<AreaModel, "buildings" | "roads" | "featuredBuildingIds">): PropertyFront | null {
  const id = area.featuredBuildingIds?.[0];
  const building = id ? area.buildings.find((b) => b.id === id) : undefined;
  if (!building) return null;
  const front = building.facade?.front ?? frontEdge(building, area.roads);
  if (!front) return null;
  const mid: Vec2 = [(front[0][0] + front[1][0]) / 2, (front[0][1] + front[1][1]) / 2];
  return { building, front, normal: frontNormal(front), mid };
}
