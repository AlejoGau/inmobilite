import { difference } from "@turf/difference";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { AreaModel, Ring, Road, Vec2 } from "@/domain/types";
import { SIDEWALK_WIDTH } from "../config/palette";
import { cleanRing, convexHull, leftNormal, normalize, signedArea, sub, withOrientation, type PolygonWithHoles } from "./polygon2d";
import { ribbonOutline, ribbonPolygon } from "./ribbon";
import { analyzeRoadNetwork, endCapExtensions, extendPolyline, type RoadNetwork } from "./roadNetwork";

/**
 * The ground as a real maquette has it: blocks are plinths at kerb height and
 * the streets are carved into them. Built with polygon booleans once per
 * area, as plain data (no three objects), so it can be cached and tested.
 */
export interface GroundPlan {
  network: RoadNetwork;
  /** Radius of the asphalt base disc. Roads run a little past the area radius. */
  discRadius: number;
  /** Everything that is not carriageway, at sidewalk height. Null if the boolean failed. */
  blocks: PolygonWithHoles[] | null;
  /** Block interiors behind the sidewalk band. Null if the boolean failed. */
  lots: PolygonWithHoles[] | null;
  /** Parks clipped to the blocks, so a lawn never floats over a street. */
  parks: PolygonWithHoles[];
}

const DISC_SEGMENTS = 96;
const DISC_MARGIN = 40;
/** Slivers smaller than this (m²) are boolean noise, not ground. */
const MIN_PIECE_AREA = 1;

type TurfPolygon = Feature<Polygon>;

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function toPositions(ring: Ring): Position[] {
  const positions = ring.map(([x, y]) => [round(x), round(y)]);
  positions.push(positions[0]);
  return positions;
}

function toTurf(rings: Ring[]): TurfPolygon | null {
  const positions = rings.map(toPositions);
  if (positions.some((r) => r.length < 4)) return null;
  return turfPolygon(positions);
}

function discRing(radius: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < DISC_SEGMENTS; i++) {
    const a = (i / DISC_SEGMENTS) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return ring;
}

function fromTurf(feature: Feature<Polygon | MultiPolygon> | null): PolygonWithHoles[] {
  if (!feature) return [];
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const out: PolygonWithHoles[] = [];
  for (const rings of polygons) {
    const [outerRaw, ...holesRaw] = rings.map((r) => cleanRing(r.map(([x, y]) => [x, y] as Vec2)));
    if (!outerRaw || outerRaw.length < 3 || Math.abs(signedArea(outerRaw)) < MIN_PIECE_AREA) continue;
    out.push({
      outer: withOrientation(outerRaw, true),
      holes: holesRaw
        .filter((h) => h.length >= 3 && Math.abs(signedArea(h)) >= MIN_PIECE_AREA)
        .map((h) => withOrientation(h, false)),
    });
  }
  return out;
}

/** Carriageway footprints, one simple polygon per road, with square caps where roads meet. */
function carriagewayPolygons(roads: Road[], widen: number): TurfPolygon[] {
  const caps = endCapExtensions(roads, widen);
  const out: TurfPolygon[] = [];
  roads.forEach((road, i) => {
    const path = extendPolyline(road.points, caps[i][0], caps[i][1]);
    const feature = toTurf([ribbonPolygon(path, road.width / 2 + widen)]);
    if (feature) out.push(feature);
  });
  return out;
}

/**
 * Same footprint as carriagewayPolygons, decomposed into convex pieces (one
 * rectangle per segment plus a mitred wedge per bend). Slower to clip, but
 * immune to the self-intersecting outlines that tight bends produce.
 */
function carriagewayPieces(roads: Road[], widen: number): TurfPolygon[] {
  const caps = endCapExtensions(roads, widen);
  const out: TurfPolygon[] = [];
  roads.forEach((road, i) => {
    const path = extendPolyline(road.points, caps[i][0], caps[i][1]);
    const hw = road.width / 2 + widen;
    for (let k = 0; k < path.length - 1; k++) {
      const piece = toTurf([ribbonPolygon([path[k], path[k + 1]], hw)]);
      if (piece) out.push(piece);
    }
    for (let k = 1; k < path.length - 1; k++) {
      const p = path[k];
      const n0 = leftNormal(normalize(sub(p, path[k - 1])));
      const n1 = leftNormal(normalize(sub(path[k + 1], p)));
      const { left, right } = ribbonOutline([path[k - 1], p, path[k + 1]], hw);
      // Both segment ends plus the two mitre corners span the whole joint.
      const joint: Vec2[] = [
        [p[0] + n0[0] * hw, p[1] + n0[1] * hw],
        [p[0] - n0[0] * hw, p[1] - n0[1] * hw],
        [p[0] + n1[0] * hw, p[1] + n1[1] * hw],
        [p[0] - n1[0] * hw, p[1] - n1[1] * hw],
        left[1],
        right[1],
      ];
      const wedge = toTurf([convexHull(joint)]);
      if (wedge) out.push(wedge);
    }
  });
  return out;
}

function subtract(base: TurfPolygon, cutters: TurfPolygon[]): PolygonWithHoles[] {
  return fromTurf(difference(featureCollection<Polygon>([base, ...cutters])));
}

function bboxOf(ring: Ring): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

function bboxOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function buildGroundPlan(area: AreaModel): GroundPlan {
  const network = analyzeRoadNetwork(area.roads);
  const discRadius = area.radius + DISC_MARGIN;
  const disc = toTurf([discRing(discRadius)]);
  const carriageways = carriagewayPolygons(network.roads, 0);

  let blocks: PolygonWithHoles[] | null = null;
  let lots: PolygonWithHoles[] | null = null;
  if (disc) {
    // Fast path with one outline per road; if a tight bend makes an outline
    // self-intersect and the sweep line throws, retry with convex pieces.
    for (const cut of [carriagewayPolygons, carriagewayPieces]) {
      try {
        blocks = subtract(disc, cut(network.roads, 0));
        lots = subtract(disc, cut(network.roads, SIDEWALK_WIDTH));
        break;
      } catch {
        // Both failing leaves blocks null: the scene falls back to flat road ribbons.
        blocks = null;
        lots = null;
      }
    }
  }

  const parks: PolygonWithHoles[] = [];
  const carriagewayBoxes = carriageways.map((c) => bboxOf(c.geometry.coordinates[0].map(([x, y]) => [x, y] as Vec2)));
  for (const park of area.parks) {
    const ring = withOrientation(cleanRing(park.polygon), true);
    const feature = toTurf([ring]);
    if (!feature) continue;
    const box = bboxOf(ring);
    const cutters = carriageways.filter((_, i) => bboxOverlap(box, carriagewayBoxes[i]));
    try {
      parks.push(...(cutters.length ? subtract(feature, cutters) : [{ outer: ring, holes: [] }]));
    } catch {
      parks.push({ outer: ring, holes: [] });
    }
  }

  return { network, discRadius, blocks, lots, parks };
}

const planCache = new WeakMap<AreaModel, GroundPlan>();

/** Same as buildGroundPlan, memoised per AreaModel object (the booleans cost tens of ms). */
export function groundPlanFor(area: AreaModel): GroundPlan {
  let plan = planCache.get(area);
  if (!plan) {
    plan = buildGroundPlan(area);
    planCache.set(area, plan);
  }
  return plan;
}
