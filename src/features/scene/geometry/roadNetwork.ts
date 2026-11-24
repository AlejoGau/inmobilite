import type { Road, Vec2 } from "@/domain/types";
import { distance, normalize, sub } from "./polygon2d";
import { dedupePolyline } from "./ribbon";

/** Roads that get an asphalt carriageway and kerbs. Footways and pedestrian streets stay at sidewalk level. */
export function isCarriageway(road: Road): boolean {
  return road.cls !== "footway" && road.cls !== "pedestrian";
}

/** An arm of a junction: one direction a road leaves it in. */
export interface JunctionLeg {
  roadIndex: number;
  /** Unit vector pointing away from the junction. */
  direction: Vec2;
  halfWidth: number;
}

export interface Junction {
  point: Vec2;
  legs: JunctionLeg[];
  /** Widest half carriageway meeting here. */
  maxHalfWidth: number;
}

export interface RoadNetwork {
  /** Carriageways only, with duplicate vertices removed. */
  roads: Road[];
  junctions: Junction[];
  /** The intersection nearest to the origin, if one is close enough to be "the corner". */
  main: Junction | null;
}

/** Further than this from the origin, the nearest junction is not the searched corner. */
const MAIN_JUNCTION_MAX_DISTANCE = 60;

function keyOf(p: Vec2): string {
  return `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
}

/**
 * Finds intersections by shared vertices: OSM splits ways at shared nodes and
 * the domain projects them deterministically, so the same node lands on the
 * same coordinates. A point is a junction when at least three arms meet
 * there; two arms are just a way split in the middle of a street.
 */
export function analyzeRoadNetwork(allRoads: Road[]): RoadNetwork {
  const roads = allRoads
    .filter(isCarriageway)
    .map((road) => ({ ...road, points: dedupePolyline(road.points) }))
    .filter((road) => road.points.length >= 2);

  const buckets = new Map<string, { point: Vec2; legs: JunctionLeg[] }>();
  roads.forEach((road, roadIndex) => {
    const pts = road.points;
    pts.forEach((p, i) => {
      const key = keyOf(p);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { point: p, legs: [] };
        buckets.set(key, bucket);
      }
      const halfWidth = road.width / 2;
      if (i > 0) bucket.legs.push({ roadIndex, direction: normalize(sub(pts[i - 1], p)), halfWidth });
      if (i < pts.length - 1) bucket.legs.push({ roadIndex, direction: normalize(sub(pts[i + 1], p)), halfWidth });
    });
  });

  const junctions: Junction[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.legs.length < 3) continue;
    junctions.push({
      point: bucket.point,
      legs: bucket.legs,
      maxHalfWidth: Math.max(...bucket.legs.map((l) => l.halfWidth)),
    });
  }
  // Deterministic order regardless of Map insertion quirks.
  junctions.sort((a, b) => a.point[0] - b.point[0] || a.point[1] - b.point[1]);

  let main: Junction | null = null;
  let best = MAIN_JUNCTION_MAX_DISTANCE;
  for (const j of junctions) {
    const d = distance(j.point, [0, 0]);
    if (d < best) {
      best = d;
      main = j;
    }
  }
  return { roads, junctions, main };
}

/**
 * How far each end of a carriageway must be extended so that ribbons meeting
 * at a shared node close the outer corner (square caps), without poking
 * past the far kerb of a narrower crossing street. Free ends get no cap.
 */
export function endCapExtensions(roads: Road[], widen = 0): Array<[start: number, end: number]> {
  const touching = new Map<string, Array<{ roadIndex: number; halfWidth: number }>>();
  roads.forEach((road, roadIndex) => {
    for (const p of road.points) {
      const key = keyOf(p);
      const list = touching.get(key) ?? [];
      list.push({ roadIndex, halfWidth: road.width / 2 + widen });
      touching.set(key, list);
    }
  });
  const capAt = (roadIndex: number, p: Vec2, halfWidth: number): number => {
    const others = (touching.get(keyOf(p)) ?? []).filter((o) => o.roadIndex !== roadIndex);
    if (others.length === 0) return 0;
    return Math.min(halfWidth, Math.max(...others.map((o) => o.halfWidth)));
  };
  return roads.map((road, i) => {
    const hw = road.width / 2 + widen;
    return [capAt(i, road.points[0], hw), capAt(i, road.points[road.points.length - 1], hw)];
  });
}

/** Extends the first and last segment of a polyline outwards. */
export function extendPolyline(points: Vec2[], start: number, end: number): Vec2[] {
  if (points.length < 2) return points;
  const out = points.map((p) => [p[0], p[1]] as Vec2);
  const d0 = normalize(sub(out[0], out[1]));
  const n = out.length;
  const d1 = normalize(sub(out[n - 1], out[n - 2]));
  out[0] = [out[0][0] + d0[0] * start, out[0][1] + d0[1] * start];
  out[n - 1] = [out[n - 1][0] + d1[0] * end, out[n - 1][1] + d1[1] * end];
  return out;
}

/**
 * Distance along a leg from the junction centre to the kerb line of the
 * crossing streets: the point where a crosswalk can start.
 */
export function legClearance(junction: Junction, leg: JunctionLeg): number {
  let clearance = leg.halfWidth * 0.5;
  for (const other of junction.legs) {
    if (other === leg) continue;
    const sin = Math.abs(leg.direction[0] * other.direction[1] - leg.direction[1] * other.direction[0]);
    if (sin < 0.25) continue; // the same street continuing on the other side
    clearance = Math.max(clearance, other.halfWidth / Math.max(sin, 0.4));
  }
  return clearance;
}
