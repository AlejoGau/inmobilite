import type { Vec2 } from "../types";
import { distance, dot, lerp, sub } from "./vec";

export interface ClosestPoint {
  point: Vec2;
  distance: number;
  /** Index of the segment [i, i+1] the point lies on. */
  segment: number;
  /** Position along that segment, 0..1. */
  t: number;
}

/** Closest point on segment ab to p, as a parameter t in [0, 1]. */
export function closestTOnSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lengthSq = dot(ab, ab);
  if (lengthSq === 0) return 0;
  return Math.max(0, Math.min(1, dot(sub(p, a), ab) / lengthSq));
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return distance(p, lerp(a, b, closestTOnSegment(p, a, b)));
}

export function closestPointOnPolyline(p: Vec2, points: Vec2[]): ClosestPoint {
  let best: ClosestPoint = { point: points[0], distance: distance(p, points[0]), segment: 0, t: 0 };
  for (let i = 0; i < points.length - 1; i++) {
    const t = closestTOnSegment(p, points[i], points[i + 1]);
    const q = lerp(points[i], points[i + 1], t);
    const d = distance(p, q);
    if (d < best.distance) best = { point: q, distance: d, segment: i, t };
  }
  return best;
}

export function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += distance(points[i], points[i + 1]);
  return total;
}

/**
 * Clips a polyline to a disc centred on the local origin. Lines that leave
 * and re-enter the disc are split into several pieces, and each piece ends
 * exactly on the circle so the scene gets clean, round edges.
 */
export function clipPolylineToCircle(points: Vec2[], radius: number): Vec2[][] {
  const pieces: Vec2[][] = [];
  let current: Vec2[] = [];

  const flush = () => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const span = segmentInsideCircle(a, b, radius);
    if (!span) {
      flush();
      continue;
    }
    const [t0, t1] = span;
    const start = t0 === 0 ? a : lerp(a, b, t0);
    const end = t1 === 1 ? b : lerp(a, b, t1);
    if (current.length === 0 || t0 > 0) {
      flush();
      current.push(start);
    }
    current.push(end);
    if (t1 < 1) flush();
  }
  flush();
  return pieces;
}

/** Parameter range [t0, t1] of segment ab that lies inside the circle, or null. */
function segmentInsideCircle(a: Vec2, b: Vec2, radius: number): [number, number] | null {
  const d = sub(b, a);
  const qa = dot(d, d);
  const qb = 2 * dot(a, d);
  const qc = dot(a, a) - radius * radius;
  if (qa === 0) return qc <= 0 ? [0, 1] : null;
  const disc = qb * qb - 4 * qa * qc;
  if (disc <= 0) return null;
  const root = Math.sqrt(disc);
  const t0 = Math.max(0, (-qb - root) / (2 * qa));
  const t1 = Math.min(1, (-qb + root) / (2 * qa));
  return t0 < t1 ? [t0, t1] : null;
}
