import { ShapeUtils, Vector2 } from "three";
import type { Ring, Vec2 } from "@/domain/types";

/**
 * Planar helpers for the scene builders. Domain coordinates: [east, north]
 * in meters. Kept local to the scene so the renderer does not depend on
 * domain internals beyond the shared contract.
 */

export interface PolygonWithHoles {
  /** Counter-clockwise. */
  outer: Ring;
  /** Clockwise. */
  holes: Ring[];
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function length(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function normalize(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]);
  return l > 1e-12 ? [v[0] / l, v[1] / l] : [0, 0];
}

/** Left-hand normal of a direction (rotated +90°). */
export function leftNormal(d: Vec2): Vec2 {
  return [-d[1], d[0]];
}

/** Shoelace area; positive for counter-clockwise rings. */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

export function withOrientation(ring: Ring, ccw: boolean): Ring {
  const isCcw = signedArea(ring) > 0;
  return isCcw === ccw ? ring : [...ring].reverse();
}

/** Drops consecutive duplicates and a repeated closing point. */
export function cleanRing(ring: Ring, epsilon = 1e-3): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > epsilon) out.push(p);
  }
  while (out.length > 1 && distance(out[0], out[out.length - 1]) <= epsilon) out.pop();
  return out;
}

export function pointInRing(p: Vec2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Area-weighted centroid; falls back to the vertex mean for degenerate rings. */
export function ringCentroid(ring: Ring): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const mean = ring.reduce<Vec2>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [mean[0] / ring.length, mean[1] / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Offsets a closed counter-clockwise ring inwards by `inset` meters with
 * mitred corners. Returns null when the result is not trustworthy (it
 * flipped, collapsed, or escaped the original), so callers can skip details
 * such as a parapet instead of drawing a broken one.
 */
export function insetRing(ring: Ring, inset: number, miterLimit = 3): Ring | null {
  const ccw = withOrientation(cleanRing(ring), true);
  const n = ccw.length;
  if (n < 3) return null;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const prev = ccw[(i - 1 + n) % n];
    const curr = ccw[i];
    const next = ccw[(i + 1) % n];
    const n0 = leftNormal(normalize(sub(curr, prev)));
    const n1 = leftNormal(normalize(sub(next, curr)));
    const bisector = normalize([n0[0] + n1[0], n0[1] + n1[1]]);
    const cos = bisector[0] * n0[0] + bisector[1] * n0[1];
    if (cos < 1e-3) return null;
    const scale = Math.min(1 / cos, miterLimit);
    // Left of a CCW edge is the interior, so moving along +normal goes inwards.
    out.push([curr[0] + bisector[0] * inset * scale, curr[1] + bisector[1] * inset * scale]);
  }
  const originalArea = signedArea(ccw);
  const insetArea = signedArea(out);
  if (insetArea <= 0 || insetArea < originalArea * 0.25) return null;
  if (!out.every((p) => pointInRing(p, ccw))) return null;
  return out;
}

/**
 * Triangulates a polygon with holes (earcut via three's ShapeUtils).
 * Returns the flattened vertex list and triangles as index triples into it.
 */
export function triangulatePolygon(polygon: PolygonWithHoles): { vertices: Vec2[]; triangles: number[][] } {
  const contour = polygon.outer.map(([x, y]) => new Vector2(x, y));
  const holes = polygon.holes.map((h) => h.map(([x, y]) => new Vector2(x, y)));
  const triangles = ShapeUtils.triangulateShape(contour, holes);
  const vertices: Vec2[] = [...polygon.outer, ...polygon.holes.flat()];
  return { vertices, triangles };
}

/** Convex hull (monotone chain), counter-clockwise, no repeated point. */
export function convexHull(points: Vec2[]): Ring {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}
