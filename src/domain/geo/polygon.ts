import type { Ring, Vec2 } from "../types";
import { cross, distance, dot, length, sub } from "./vec";

/** Vertices closer than this are merged (meters). OSM often has doubled nodes. */
const DUPLICATE_EPSILON = 0.1;
/** A vertex this close to the line through its neighbours adds nothing (meters). */
const COLLINEAR_EPSILON = 0.05;

/** Shoelace area. Positive for counter-clockwise rings. */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

export function polygonArea(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

/** Area-weighted centroid. Falls back to the vertex mean for degenerate rings. */
export function centroid(ring: Ring): Vec2 {
  const a = signedArea(ring);
  if (Math.abs(a) < 1e-9) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  // Relative to the first vertex, so large coordinates do not lose precision.
  const [ox, oy] = ring[0];
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xj = ring[j][0] - ox;
    const yj = ring[j][1] - oy;
    const xi = ring[i][0] - ox;
    const yi = ring[i][1] - oy;
    const f = xj * yi - xi * yj;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  return [ox + cx / (6 * a), oy + cy / (6 * a)];
}

/** Even-odd point-in-polygon test. */
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

/**
 * Normalises a raw closed polyline into the contract's Ring: no repeated
 * closing point, no near-duplicate or collinear vertices, counter-clockwise.
 * Returns null when nothing polygon-like is left.
 */
export function normalizeRing(points: Vec2[]): Ring | null {
  let ring = dropClosingPoint(points);
  ring = removeNearDuplicates(ring);
  ring = removeCollinear(ring);
  if (ring.length < 3) return null;
  return signedArea(ring) < 0 ? ring.reverse() : ring;
}

function dropClosingPoint(points: Vec2[]): Vec2[] {
  const ring = points.slice();
  while (ring.length > 1 && distance(ring[0], ring[ring.length - 1]) < DUPLICATE_EPSILON) {
    ring.pop();
  }
  return ring;
}

function removeNearDuplicates(ring: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    if (out.length === 0 || distance(out[out.length - 1], p) >= DUPLICATE_EPSILON) out.push(p);
  }
  while (out.length > 1 && distance(out[0], out[out.length - 1]) < DUPLICATE_EPSILON) out.pop();
  return out;
}

/** Removes vertices lying on the segment between their neighbours, until stable. */
function removeCollinear(ring: Vec2[]): Vec2[] {
  let current = ring;
  let changed = true;
  while (changed && current.length >= 3) {
    changed = false;
    const next: Vec2[] = [];
    for (let i = 0; i < current.length; i++) {
      const prev = next.length > 0 ? next[next.length - 1] : current[current.length - 1];
      const p = current[i];
      const after = current[(i + 1) % current.length];
      if (isRedundantVertex(prev, p, after)) {
        changed = true;
      } else {
        next.push(p);
      }
    }
    current = next;
  }
  return current;
}

function isRedundantVertex(prev: Vec2, p: Vec2, next: Vec2): boolean {
  const base = sub(next, prev);
  const baseLength = length(base);
  if (baseLength < DUPLICATE_EPSILON) return true;
  const offset = Math.abs(cross(base, sub(p, prev))) / baseLength;
  // Only a vertex that sits BETWEEN its neighbours is redundant; a spike that
  // doubles back is a real (if odd) feature of the outline.
  const along = dot(sub(p, prev), base) / (baseLength * baseLength);
  return offset < COLLINEAR_EPSILON && along > 0 && along < 1;
}
