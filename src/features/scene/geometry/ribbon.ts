import type { BufferGeometry } from "three";
import type { Vec2 } from "@/domain/types";
import { MeshBuilder, toScene } from "./meshBuilder";
import { distance, leftNormal, normalize, sub } from "./polygon2d";

/** Mitre length is clamped to this multiple of the offset, so hairpins do not spike. */
export const DEFAULT_MITER_LIMIT = 2.5;

/** Drops consecutive points closer than `epsilon` (OSM has duplicated nodes now and then). */
export function dedupePolyline(points: Vec2[], epsilon = 0.01): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > epsilon) out.push(p);
  }
  return out;
}

/**
 * Mitred offset direction at every vertex of an open polyline, already
 * scaled so that `point + miter * offset` lands at `offset` from both
 * neighbouring segments (clamped by the mitre limit).
 */
export function miterVectors(points: Vec2[], miterLimit = DEFAULT_MITER_LIMIT): Vec2[] {
  const n = points.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const incoming = i > 0 ? leftNormal(normalize(sub(points[i], points[i - 1]))) : null;
    const outgoing = i < n - 1 ? leftNormal(normalize(sub(points[i + 1], points[i]))) : null;
    const n0 = incoming ?? outgoing ?? [0, 0];
    const n1 = outgoing ?? incoming ?? [0, 0];
    let bisector = normalize([n0[0] + n1[0], n0[1] + n1[1]]);
    if (bisector[0] === 0 && bisector[1] === 0) bisector = n0; // 180° turn
    const cos = bisector[0] * n0[0] + bisector[1] * n0[1];
    const scale = Math.min(1 / Math.max(cos, 1e-6), miterLimit);
    out.push([bisector[0] * scale, bisector[1] * scale]);
  }
  return out;
}

/** Offsets an open polyline sideways; positive offsets go to the left of the direction of travel. */
export function offsetPolyline(points: Vec2[], offset: number, miterLimit = DEFAULT_MITER_LIMIT): Vec2[] {
  const clean = dedupePolyline(points);
  const miters = miterVectors(clean, miterLimit);
  return clean.map((p, i) => [p[0] + miters[i][0] * offset, p[1] + miters[i][1] * offset]);
}

export interface RibbonOutline {
  left: Vec2[];
  right: Vec2[];
}

export function ribbonOutline(points: Vec2[], halfWidth: number, miterLimit = DEFAULT_MITER_LIMIT): RibbonOutline {
  return {
    left: offsetPolyline(points, halfWidth, miterLimit),
    right: offsetPolyline(points, -halfWidth, miterLimit),
  };
}

/** Closed outline of a ribbon (left side forward, right side back). Not repeated at the end. */
export function ribbonPolygon(points: Vec2[], halfWidth: number, miterLimit = DEFAULT_MITER_LIMIT): Vec2[] {
  const { left, right } = ribbonOutline(points, halfWidth, miterLimit);
  return [...left, ...right.reverse()];
}

/**
 * Flat triangle-strip ribbon facing up. UVs: u = distance along the
 * centreline in meters, v = 0 on the right edge and 1 on the left edge.
 */
export function addRibbon(builder: MeshBuilder, points: Vec2[], halfWidth: number, height: number, miterLimit = DEFAULT_MITER_LIMIT): void {
  const clean = dedupePolyline(points);
  if (clean.length < 2) return;
  const { left, right } = ribbonOutline(clean, halfWidth, miterLimit);
  let along = 0;
  for (let i = 0; i < clean.length - 1; i++) {
    const next = along + distance(clean[i], clean[i + 1]);
    builder.quad(
      toScene(right[i], height),
      toScene(right[i + 1], height),
      toScene(left[i + 1], height),
      toScene(left[i], height),
      [0, 1, 0],
      [
        [along, 0],
        [next, 0],
        [next, 1],
        [along, 1],
      ],
    );
    along = next;
  }
}

export function buildRibbonGeometry(points: Vec2[], halfWidth: number, height: number, miterLimit = DEFAULT_MITER_LIMIT): BufferGeometry {
  const builder = new MeshBuilder();
  addRibbon(builder, points, halfWidth, height, miterLimit);
  return builder.build();
}
