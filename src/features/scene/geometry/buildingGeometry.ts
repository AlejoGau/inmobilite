import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import { union } from "@turf/union";
import type { BufferGeometry } from "three";
import { mulberry32, randomBetween } from "@/domain/seed";
import type { Building, Ring, Vec2 } from "@/domain/types";
import { facadeKey, planBuilding, PLAN_SPEC, spanTop, type FacadeLayout, type PlannedPart, type WallSpan } from "./buildingPlan";
import { MeshBuilder, toScene, type Vec3 } from "./meshBuilder";
import { cleanRing, distance, normalize, pointInRing, ringCentroid, signedArea, sub, triangulatePolygon, withOrientation, type PolygonWithHoles } from "./polygon2d";

/** Per-vertex attribute the facade shader reads: (u along the facade run, run id, half run length; 0 = no windows). */
export const FACADE_ATTRIBUTE = "facade";
/** Per-vertex attribute with the limits of the part a face belongs to: (roof height, top of this face's wall, storeys with windows). */
export const FACADE_TOP_ATTRIBUTE = "facadeTop";

export const BUILDING_SPEC = {
  parapetInset: PLAN_SPEC.parapetInset,
  parapetLow: PLAN_SPEC.parapetLow,
  parapetTall: PLAN_SPEC.parapetTall,
  /** Buildings taller than this many levels get a machine room (and often a water tank) on the roof. */
  rooftopMinLevels: 6,
  /** Highest a procedural machine room plus its tank can rise above the roof slab. */
  maxRooftopRise: 3.2 + 1.9,
} as const;

/**
 * How far above a part's roof the building may reach (parapet, procedural
 * rooftop structures). For bounds that are computed from the area alone,
 * such as the shadow camera.
 */
export function roofAllowance(building: Building): number {
  return hasProceduralRooftop(building) ? Math.max(BUILDING_SPEC.parapetTall, BUILDING_SPEC.maxRooftopRise) : BUILDING_SPEC.parapetTall;
}

/** The GCBA model already carries the real machine rooms and tanks as parts; only other sources get invented ones. */
function hasProceduralRooftop(building: Building): boolean {
  return building.heightSource !== "gcba" && building.levels > BUILDING_SPEC.rooftopMinLevels;
}

export interface BuildingMeshData {
  geometry: BufferGeometry;
  /** Roof height of the tallest part, in meters. */
  wallHeight: number;
  /** Highest parapet top (or roof, without parapets): where the rising "edge light" ends. */
  rimHeight: number;
  /** Highest point, including rooftop structures. */
  topHeight: number;
  /** Footprint centroid in three space at ground level. */
  centre: Vec3;
  /** Radius of a sphere around the building centre that contains it. */
  boundingRadius: number;
  /** Top of the tallest part, in three space: where the selection tag hangs. */
  tagAnchor: Vec3;
  /** Volumes extruded (parts left after dropping degenerate footprints). */
  partCount: number;
}

interface Box {
  centre: Vec2;
  /** Unit vector of the box's long side. */
  axis: Vec2;
  width: number;
  depth: number;
  bottom: number;
  top: number;
}

const NO_FACADE = [0, 0, 0];

function boxCorners(box: Box, shrink = 1): Vec2[] {
  const [ax, ay] = box.axis;
  const px = -ay;
  const py = ax;
  const hw = (box.width / 2) * shrink;
  const hd = (box.depth / 2) * shrink;
  const [cx, cy] = box.centre;
  return [
    [cx - ax * hw - px * hd, cy - ay * hw - py * hd],
    [cx + ax * hw - px * hd, cy + ay * hw - py * hd],
    [cx + ax * hw + px * hd, cy + ay * hw + py * hd],
    [cx - ax * hw + px * hd, cy - ay * hw + py * hd],
  ];
}

function longestEdgeDirection(ring: Ring): Vec2 {
  let best: Vec2 = [1, 0];
  let bestLength = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = distance(a, b);
    if (len > bestLength) {
      bestLength = len;
      best = normalize(sub(b, a));
    }
  }
  return best;
}

/** Outward horizontal normal of a counter-clockwise edge, in three space (z = -north). */
function outwardNormal(dir: Vec2): Vec3 {
  return [dir[1], 0, dir[0]];
}

/** Horizontal normal of the vertical face through p -> q, pointing away from `away`. */
function normalAwayFrom(p: Vec2, q: Vec2, away: Vec2): Vec3 {
  const d = normalize(sub(q, p));
  let n: Vec2 = [d[1], -d[0]];
  const toAway = sub(away, p);
  if (n[0] * toAway[0] + n[1] * toAway[1] > 0) n = [-n[0], -n[1]];
  return [n[0], 0, -n[1]];
}

/** A vertical quad p -> q between two heights, with no window grid. */
function addPlainWall(builder: MeshBuilder, p: Vec2, q: Vec2, bottom: number, top: number, normal: Vec3): void {
  builder.setAttribute(FACADE_ATTRIBUTE, NO_FACADE);
  builder.quad(toScene(p, bottom), toScene(q, bottom), toScene(q, top), toScene(p, top), normal);
}

function addFlatTop(builder: MeshBuilder, outer: Ring, holes: Ring[], height: number): void {
  builder.setAttribute(FACADE_ATTRIBUTE, NO_FACADE);
  const { vertices, triangles } = triangulatePolygon({ outer, holes });
  for (const [i, j, k] of triangles) {
    builder.triangle(toScene(vertices[i], height), toScene(vertices[j], height), toScene(vertices[k], height), [0, 1, 0], vertices[i], vertices[j], vertices[k]);
  }
}

function addBox(builder: MeshBuilder, box: Box): void {
  const corners = withOrientation(boxCorners(box), true);
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    addPlainWall(builder, a, b, box.bottom, box.top, outwardNormal(normalize(sub(b, a))));
  }
  addFlatTop(builder, corners, [], box.top);
}

/** Seeded machine room (and maybe a water tank on it), only if it fits inside the parapet. */
function rooftopBoxes(building: Building, roofRing: Ring, roofHeight: number): Box[] {
  const rng = mulberry32(building.seed ^ 0x5bd1e995);
  const axis = longestEdgeDirection(roofRing);
  const centroid = ringCentroid(roofRing);
  const machineRoom: Box = {
    centre: centroid,
    axis,
    width: randomBetween(rng, 3.2, 5),
    depth: randomBetween(rng, 2.8, 4),
    bottom: roofHeight,
    top: roofHeight + randomBetween(rng, 2.6, 3.2),
  };
  // Nudge it off-centre a little, as real ones are, then shrink until it fits.
  const nudge = randomBetween(rng, -0.25, 0.25) * machineRoom.width;
  machineRoom.centre = [centroid[0] + axis[0] * nudge, centroid[1] + axis[1] * nudge];
  const hasTank = rng() < 0.65;
  for (const shrink of [1, 0.8, 0.6]) {
    const candidate: Box = { ...machineRoom, width: machineRoom.width * shrink, depth: machineRoom.depth * shrink };
    if (!boxCorners(candidate).every((p) => pointInRing(p, roofRing))) continue;
    if (!hasTank) return [candidate];
    const tankSide = Math.min(candidate.width, candidate.depth) * 0.7;
    const tank: Box = {
      centre: candidate.centre,
      axis,
      width: tankSide,
      depth: tankSide,
      bottom: candidate.top,
      top: candidate.top + randomBetween(rng, 1.4, 1.9),
    };
    return [candidate, tank];
  }
  return [];
}

/**
 * Facade walls of one part. Every edge is split into stretches by how high a
 * neighbouring part hides it; only the visible band of each stretch is drawn,
 * so abutting parts never put two walls on the same plane. UVs follow the
 * part's perimeter in meters (u along it, v = height).
 */
function addPartWalls(builder: MeshBuilder, part: PlannedPart, index: number, facades: Map<string, FacadeLayout>): void {
  let perimeter = 0;
  part.edges.forEach((edge, e) => {
    const normal = outwardNormal(edge.dir);
    edge.spans.forEach((span, s) => {
      const bottom = span.cover;
      const top = spanTop(part, span);
      if (top - bottom < 1e-3 || span.t1 - span.t0 < 1e-3) return;
      const p = pointAt(edge.a, edge.dir, span.t0);
      const q = pointAt(edge.a, edge.dir, span.t1);
      builder.setAttribute(FACADE_TOP_ATTRIBUTE, [part.height, top, part.levels]);
      const layout = facades.get(facadeKey(index, e, s));
      // A half length of 0 tells the shader "no windows here".
      const at = (u: number) => (layout && layout.halfLength > 0 ? [u, layout.runId, layout.halfLength] : NO_FACADE);
      const u0 = layout?.u0 ?? 0;
      const u1 = layout?.u1 ?? 0;
      builder.quad(
        toScene(p, bottom),
        toScene(q, bottom),
        toScene(q, top),
        toScene(p, top),
        normal,
        [
          [perimeter + span.t0, bottom],
          [perimeter + span.t1, bottom],
          [perimeter + span.t1, top],
          [perimeter + span.t0, top],
        ],
        { name: FACADE_ATTRIBUTE, values: [at(u0), at(u1), at(u1), at(u0)] },
      );
    });
    perimeter += edge.length;
  });
}

function pointAt(a: Vec2, dir: Vec2, t: number): Vec2 {
  return [a[0] + dir[0] * t, a[1] + dir[1] * t];
}

/**
 * Parapet strips along the exposed stretches of the roof edge: cap, inner
 * face, and an end face wherever the strip stops (against a taller or equal
 * neighbour). Strips meet at the mitred inner corners, and a stretch ending
 * mid-edge is cut square, clamped into its edge's trapezoid, so strips never
 * overlap.
 */
function addParapets(builder: MeshBuilder, part: PlannedPart): void {
  const inner = part.parapetInner;
  if (!inner) return;
  const roof = part.height;
  const rim = part.height + part.parapetHeight;
  builder.setAttribute(FACADE_ATTRIBUTE, NO_FACADE);
  builder.setAttribute(FACADE_TOP_ATTRIBUTE, [part.height, rim, part.levels]);

  interface Strip {
    span: WallSpan;
    outer: [Vec2, Vec2];
    inner: [Vec2, Vec2];
  }
  const strips: Strip[] = [];
  const n = part.edges.length;
  part.edges.forEach((edge, k) => {
    const mk = inner[k];
    const mk1 = inner[(k + 1) % n];
    const sk = (mk[0] - edge.a[0]) * edge.dir[0] + (mk[1] - edge.a[1]) * edge.dir[1];
    const sk1 = (mk1[0] - edge.a[0]) * edge.dir[0] + (mk1[1] - edge.a[1]) * edge.dir[1];
    const innerAt = (t: number): Vec2 => {
      if (t <= 1e-6) return mk;
      if (t >= edge.length - 1e-6) return mk1;
      const s = Math.min(sk1, Math.max(sk, t));
      const lambda = (s - sk) / (sk1 - sk);
      return [mk[0] + (mk1[0] - mk[0]) * lambda, mk[1] + (mk1[1] - mk[1]) * lambda];
    };
    for (const span of edge.spans) {
      strips.push({
        span,
        outer: [pointAt(edge.a, edge.dir, span.t0), pointAt(edge.a, edge.dir, span.t1)],
        inner: [innerAt(span.t0), innerAt(span.t1)],
      });
    }
  });

  strips.forEach((strip, i) => {
    if (!strip.span.parapet) return;
    const [a, b] = strip.outer;
    const [ai, bi] = strip.inner;
    builder.quad(toScene(a, rim), toScene(b, rim), toScene(bi, rim), toScene(ai, rim), [0, 1, 0], [a, b, bi, ai]);
    // The inner face looks across the roof, away from the facade.
    addPlainWall(builder, ai, bi, roof, rim, normalAwayFrom(ai, bi, a));
    const centre: Vec2 = [(a[0] + b[0] + ai[0] + bi[0]) / 4, (a[1] + b[1] + ai[1] + bi[1]) / 4];
    if (!strips[(i - 1 + strips.length) % strips.length].span.parapet) addPlainWall(builder, a, ai, roof, rim, normalAwayFrom(a, ai, centre));
    if (!strips[(i + 1) % strips.length].span.parapet) addPlainWall(builder, b, bi, roof, rim, normalAwayFrom(b, bi, centre));
  });
}

/** Roofs of parts within this many meters of each other count as one level. */
const SAME_ROOF_TOLERANCE = 1e-3;

/**
 * Roof outlines at one level, as polygons with holes. Parts of equal height
 * are merged first: their source footprints can overlap by a sliver
 * (photogrammetry noise, a few cm wide), and two slabs on the same plane
 * there would z-fight. Merging also drops the seams across a flat roof.
 */
function mergedRoofs(rings: Ring[]): PolygonWithHoles[] {
  if (rings.length === 1) return [{ outer: rings[0], holes: [] }];
  try {
    const merged = union(featureCollection(rings.map((ring) => turfPolygon([[...ring, ring[0]].map(([x, y]) => [x, y])]))));
    if (!merged) return [];
    const polygons = merged.geometry.type === "Polygon" ? [merged.geometry.coordinates] : merged.geometry.coordinates;
    const out: PolygonWithHoles[] = [];
    for (const [outer, ...holes] of polygons) {
      const ring = withOrientation(cleanRing(outer.map(([x, y]): Vec2 => [x, y])), true);
      if (ring.length < 3) continue;
      out.push({ outer: ring, holes: holes.map((h) => withOrientation(cleanRing(h.map(([x, y]): Vec2 => [x, y])), false)).filter((h) => h.length >= 3) });
    }
    return out;
  } catch {
    // A degenerate union: separate slabs z-fight on a sliver at worst, which beats a missing roof.
    return rings.map((outer) => ({ outer, holes: [] }));
  }
}

/** Roof slabs of every part, one merged slab per roof level. */
function addRoofs(builder: MeshBuilder, parts: PlannedPart[]): void {
  const levels: PlannedPart[][] = [];
  for (const part of [...parts].sort((a, b) => a.height - b.height)) {
    const level = levels[levels.length - 1];
    if (level && part.height - level[0].height <= SAME_ROOF_TOLERANCE) level.push(part);
    else levels.push([part]);
  }
  for (const level of levels) {
    const height = level[0].height;
    const rim = Math.max(...level.map((p) => p.height + p.parapetHeight));
    builder.setAttribute(FACADE_TOP_ATTRIBUTE, [height, rim, Math.max(...level.map((p) => p.levels))]);
    // The whole footprint: under a parapet the slab is hidden inside its solid, and it never shares a plane with it.
    for (const roof of mergedRoofs(level.map((p) => p.ring))) addFlatTop(builder, roof.outer, roof.holes, height);
  }
}

function tallestPart(parts: PlannedPart[]): PlannedPart | null {
  let best: PlannedPart | null = null;
  for (const part of parts) {
    if (!best || part.height > best.height + 1e-6 || (Math.abs(part.height - best.height) <= 1e-6 && part.area > best.area)) best = part;
  }
  return best;
}

/**
 * One BufferGeometry for a whole building, with flat normals: every part is a
 * prism from the ground with its facade walls (carrying the window grid),
 * parapets along the open edges of its roof, and its roof slab. Rooftop
 * volumes and tiny parts stay plain clay. Buildings that do not come from the
 * GCBA model get a seeded machine room and tank on their tallest roof.
 */
export function buildBuildingGeometry(building: Building): BuildingMeshData {
  const plan = planBuilding(building);
  const builder = new MeshBuilder().defineAttribute(FACADE_ATTRIBUTE, 3).defineAttribute(FACADE_TOP_ATTRIBUTE, 3);

  let rimHeight = 0;
  plan.parts.forEach((part, index) => {
    const rim = part.height + part.parapetHeight;
    rimHeight = Math.max(rimHeight, rim);
    addPartWalls(builder, part, index, plan.facades);
    addParapets(builder, part);
  });
  addRoofs(builder, plan.parts);

  const tallest = tallestPart(plan.parts);
  let topHeight = rimHeight;
  let tagTop = tallest ? tallest.height + tallest.parapetHeight : 0;
  if (tallest?.parapetInner && hasProceduralRooftop(building)) {
    builder.setAttribute(FACADE_TOP_ATTRIBUTE, [tallest.height, rimHeight, tallest.levels]);
    for (const box of rooftopBoxes(building, tallest.parapetInner, tallest.height)) {
      addBox(builder, box);
      topHeight = Math.max(topHeight, box.top);
      tagTop = Math.max(tagTop, box.top);
    }
  }

  const outline = withOrientation(cleanRing(building.footprint), true);
  const c = outline.length >= 3 && Math.abs(signedArea(outline)) > 1e-6 ? ringCentroid(outline) : tallest ? ringCentroid(tallest.ring) : ([0, 0] as Vec2);
  const vertices = plan.parts.flatMap((p) => p.ring);
  const footprintRadius = vertices.length ? Math.max(...vertices.map((p) => distance(p, c))) : 0;
  const anchor = tallest ? ringCentroid(tallest.ring) : c;
  return {
    geometry: builder.build(),
    wallHeight: tallest?.height ?? 0,
    rimHeight,
    topHeight,
    centre: toScene(c, 0),
    boundingRadius: Math.hypot(footprintRadius, topHeight / 2),
    tagAnchor: toScene(anchor, tagTop),
    partCount: plan.parts.length,
  };
}
