import { Color, type BufferGeometry } from "three";
import type { Road, Vec2 } from "@/domain/types";
import { LAYERS, PALETTE } from "../config/palette";
import { MeshBuilder, toScene } from "./meshBuilder";
import { distance, leftNormal, normalize, sub } from "./polygon2d";
import { offsetPolyline } from "./ribbon";
import { legClearance, type Junction, type RoadNetwork } from "./roadNetwork";

export const MARKING_SPEC = {
  centreDash: 3,
  centreGap: 5,
  centreWidth: 0.15,
  edgeWidth: 0.12,
  /** From the kerb to the edge line. */
  edgeInset: 0.45,
  /** Zebra stripes: run parallel to traffic, laid side by side across the carriageway. */
  stripeWidth: 0.5,
  stripeGap: 0.55,
  crosswalkLength: 3.2,
  crosswalkSetback: 0.9,
  kerbMargin: 0.35,
} as const;

/** Paint never runs through a junction box. */
interface ClearZone {
  centre: Vec2;
  radius: number;
}

export interface CrosswalkStripe {
  /** Four corners in domain coordinates, in loop order. */
  corners: [Vec2, Vec2, Vec2, Vec2];
}

function isAvenue(road: Road): boolean {
  return road.cls === "primary" || (road.cls === "secondary" && road.width >= 12);
}

function hasCentreLine(road: Road): boolean {
  return road.cls === "primary" || road.cls === "secondary";
}

/** Zebra stripes on every leg of a junction. */
export function crosswalkStripes(junction: Junction): CrosswalkStripe[] {
  const stripes: CrosswalkStripe[] = [];
  const { stripeWidth, stripeGap, crosswalkLength, crosswalkSetback, kerbMargin } = MARKING_SPEC;
  for (const leg of junction.legs) {
    const start = legClearance(junction, leg) + crosswalkSetback;
    const end = start + crosswalkLength;
    const across = leftNormal(leg.direction);
    const usable = leg.halfWidth - kerbMargin;
    if (usable <= stripeWidth) continue;
    const pitch = stripeWidth + stripeGap;
    const count = Math.floor((2 * usable + stripeGap) / pitch);
    // Centre the set of stripes across the carriageway.
    const first = -((count * pitch - stripeGap) / 2);
    for (let k = 0; k < count; k++) {
      const a = first + k * pitch;
      const b = a + stripeWidth;
      const at = (s: number, t: number): Vec2 => [
        junction.point[0] + leg.direction[0] * s + across[0] * t,
        junction.point[1] + leg.direction[1] * s + across[1] * t,
      ];
      stripes.push({ corners: [at(start, a), at(end, a), at(end, b), at(start, b)] });
    }
  }
  return stripes;
}

/** Splits a polyline into straight pieces no longer than `step`, tagged with their arc length. */
function* walkPolyline(points: Vec2[], step: number): Generator<{ a: Vec2; b: Vec2; s0: number; s1: number }> {
  let s = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const len = distance(p, q);
    const pieces = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < pieces; k++) {
      const t0 = k / pieces;
      const t1 = (k + 1) / pieces;
      yield {
        a: [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0],
        b: [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1],
        s0: s + len * t0,
        s1: s + len * t1,
      };
    }
    s += len;
  }
}

function isClear(p: Vec2, zones: ClearZone[]): boolean {
  for (const z of zones) if (distance(p, z.centre) < z.radius) return false;
  return true;
}

function addLineQuad(builder: MeshBuilder, a: Vec2, b: Vec2, width: number): void {
  const n = leftNormal(normalize(sub(b, a)));
  const h = width / 2;
  const y = LAYERS.marking;
  builder.quad(
    toScene([a[0] - n[0] * h, a[1] - n[1] * h], y),
    toScene([b[0] - n[0] * h, b[1] - n[1] * h], y),
    toScene([b[0] + n[0] * h, b[1] + n[1] * h], y),
    toScene([a[0] + n[0] * h, a[1] + n[1] * h], y),
    [0, 1, 0],
  );
}

/** Emits paint along a polyline, keeping only the pieces outside the junction boxes. */
function paintAlong(
  builder: MeshBuilder,
  points: Vec2[],
  width: number,
  zones: ClearZone[],
  dash: { on: number; off: number } | null,
): void {
  for (const piece of walkPolyline(points, 1)) {
    const mid: Vec2 = [(piece.a[0] + piece.b[0]) / 2, (piece.a[1] + piece.b[1]) / 2];
    if (!isClear(mid, zones)) continue;
    if (dash) {
      const period = dash.on + dash.off;
      const len = piece.s1 - piece.s0;
      const lerp = (t: number): Vec2 => [piece.a[0] + (piece.b[0] - piece.a[0]) * t, piece.a[1] + (piece.b[1] - piece.a[1]) * t];
      // A piece is shorter than a period, so it overlaps at most two "on" intervals.
      const firstPeriod = Math.floor(piece.s0 / period);
      for (let k = firstPeriod; k <= firstPeriod + 1; k++) {
        const onStart = Math.max(piece.s0, k * period) - piece.s0;
        const onEnd = Math.min(piece.s1, k * period + dash.on) - piece.s0;
        if (onEnd > onStart + 1e-3) addLineQuad(builder, lerp(onStart / len), lerp(onEnd / len), width);
      }
    } else {
      addLineQuad(builder, piece.a, piece.b, width);
    }
  }
}

function clearZones(network: RoadNetwork): ClearZone[] {
  return network.junctions.map((j) => {
    const isMain = j === network.main;
    const crosswalkReach = isMain
      ? Math.max(...j.legs.map((l) => legClearance(j, l))) + MARKING_SPEC.crosswalkSetback + MARKING_SPEC.crosswalkLength + 0.6
      : 0;
    return { centre: j.point, radius: Math.max(j.maxHalfWidth + 1.5, crosswalkReach) };
  });
}

/**
 * Lane paint as one geometry with a per-vertex colour: dashed centre lines on
 * primary and secondary roads, solid edge lines on avenues, and zebra
 * crosswalks on every leg of the main intersection.
 */
export function buildMarkingsGeometry(network: RoadNetwork): BufferGeometry {
  const builder = new MeshBuilder().defineAttribute("color", 3);
  const zones = clearZones(network);
  const tint = (hex: string) => builder.setAttribute("color", new Color(hex).toArray());

  tint(PALETTE.markingCentre);
  for (const road of network.roads) {
    if (!hasCentreLine(road)) continue;
    paintAlong(builder, road.points, MARKING_SPEC.centreWidth, zones, { on: MARKING_SPEC.centreDash, off: MARKING_SPEC.centreGap });
  }

  tint(PALETTE.markingEdge);
  for (const road of network.roads) {
    if (!isAvenue(road)) continue;
    const offset = road.width / 2 - MARKING_SPEC.edgeInset;
    for (const side of [1, -1]) {
      paintAlong(builder, offsetPolyline(road.points, offset * side), MARKING_SPEC.edgeWidth, zones, null);
    }
  }

  tint(PALETTE.crosswalk);
  if (network.main) {
    for (const stripe of crosswalkStripes(network.main)) {
      const [a, b, c, d] = stripe.corners.map((p) => toScene(p, LAYERS.marking));
      builder.quad(a, b, c, d, [0, 1, 0]);
    }
  }

  return builder.build();
}
