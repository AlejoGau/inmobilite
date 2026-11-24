import type { Road, StreetLabel, Vec2 } from "../types";
import { closestPointOnPolyline, type ClosestPoint } from "../geo/polyline";
import { distance, lerp, round3, roundVec } from "../geo/vec";

export const MAX_LABELS = 8;
/**
 * The closest point of BOTH streets at the searched corner is the corner
 * itself, so the two labels would sit on top of each other. Each anchor is
 * slid this far along its street, away from the corner, to separate them.
 */
export const LABEL_SLIDE = 22;

export interface NamedStreet {
  name: string;
  /** Distance from the origin to the closest point of the street. */
  distance: number;
  road: Road;
  closest: ClosestPoint;
}

const ORIGIN: Vec2 = [0, 0];

/** Unique street names (footways excluded), closest to the origin first. */
export function rankStreets(roads: Road[]): NamedStreet[] {
  const byName = new Map<string, NamedStreet>();
  for (const road of roads) {
    if (!road.name || road.cls === "footway") continue;
    const closest = closestPointOnPolyline(ORIGIN, road.points);
    const current = byName.get(road.name);
    if (!current || closest.distance < current.distance) {
      byName.set(road.name, { name: road.name, distance: closest.distance, road, closest });
    }
  }
  return [...byName.values()].sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
}

export function buildLabels(streets: NamedStreet[]): StreetLabel[] {
  return streets.slice(0, MAX_LABELS).map(({ name, road, closest }) => {
    const anchor = slideAlong(road.points, closest.segment, closest.t, slideOffset(road.points, closest));
    return {
      name,
      position: roundVec(anchor.point),
      angle: round3(readableAngle(road.points[anchor.segment], road.points[anchor.segment + 1])),
    };
  });
}

/** Segment angle normalised to (-π/2, π/2], so text never reads upside down. */
export function readableAngle(a: Vec2, b: Vec2): number {
  let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle <= -Math.PI / 2) angle += Math.PI;
  return angle;
}

/**
 * Signed slide distance. Prefers the reading direction (rightwards or up),
 * so labels at a corner fan out consistently; when the way ends there (OSM
 * often splits streets at the corner node) it slides the other way.
 */
function slideOffset(points: Vec2[], { segment, t }: ClosestPoint): number {
  const ahead = remainingLength(points, segment, t, 1);
  const behind = remainingLength(points, segment, t, -1);
  const [a, b] = [points[segment], points[segment + 1]];
  const raw = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const readingAhead = raw > -Math.PI / 2 && raw <= Math.PI / 2;
  const preferred = readingAhead ? ahead : behind;
  if (preferred >= LABEL_SLIDE) return readingAhead ? LABEL_SLIDE : -LABEL_SLIDE;
  const useAhead = ahead >= behind;
  return Math.min(LABEL_SLIDE, useAhead ? ahead : behind) * (useAhead ? 1 : -1);
}

function remainingLength(points: Vec2[], segment: number, t: number, step: 1 | -1): number {
  const start = lerp(points[segment], points[segment + 1], t);
  if (step > 0) {
    let total = distance(start, points[segment + 1]);
    for (let i = segment + 1; i < points.length - 1; i++) total += distance(points[i], points[i + 1]);
    return total;
  }
  let total = distance(start, points[segment]);
  for (let i = segment; i > 0; i--) total += distance(points[i - 1], points[i]);
  return total;
}

/**
 * Walks `offset` meters along the polyline from (segment, t); negative walks
 * backwards. Stops at the polyline's end when it is shorter than the offset.
 */
function slideAlong(points: Vec2[], segment: number, t: number, offset: number): { point: Vec2; segment: number } {
  let i = segment;
  let point = lerp(points[i], points[i + 1], t);
  let remaining = Math.abs(offset);
  const step = offset >= 0 ? 1 : -1;

  while (remaining > 0) {
    const target = step > 0 ? points[i + 1] : points[i];
    const left = distance(point, target);
    if (left >= remaining) {
      return { point: lerp(point, target, remaining / left), segment: i };
    }
    remaining -= left;
    point = target;
    const nextSegment = i + step;
    if (nextSegment < 0 || nextSegment > points.length - 2) break;
    i = nextSegment;
  }
  return { point, segment: i };
}
