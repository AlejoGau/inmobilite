import type { BufferGeometry } from "three";
import { mulberry32, randomBetween } from "@/domain/seed";
import type { Building, Ring, Vec2 } from "@/domain/types";
import { MeshBuilder, toScene, type Vec3 } from "./meshBuilder";
import {
  cleanRing,
  distance,
  insetRing,
  normalize,
  pointInRing,
  ringCentroid,
  sub,
  triangulatePolygon,
  withOrientation,
} from "./polygon2d";

/** Name of the per-vertex attribute the facade shader reads: (u along the edge, edge id, half edge length). */
export const FACADE_ATTRIBUTE = "facade";

export const BUILDING_SPEC = {
  parapetInset: 0.3,
  parapetLow: 0.6,
  parapetTall: 1.0,
  /** Buildings taller than this many levels get a machine room (and often a water tank) on the roof. */
  rooftopMinLevels: 6,
} as const;

export interface BuildingMeshData {
  geometry: BufferGeometry;
  /** Height of the facade walls (the roof slab), in meters. */
  wallHeight: number;
  /** Top of the parapet: where the rising "edge light" sits. */
  rimHeight: number;
  /** Highest point, including rooftop structures. */
  topHeight: number;
  /** Footprint centroid in three space at ground level. */
  centre: Vec3;
  /** Radius of a sphere around the building centre that contains it. */
  boundingRadius: number;
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

/**
 * Walls of a ring, facing right of each edge (outwards for a CCW ring,
 * towards the roof for a CW one). UVs follow the perimeter: u = distance
 * along it, v = height, both in meters. The facade attribute additionally
 * carries an edge-local u centred on the edge, so window columns are laid
 * out symmetrically on every facade and never straddle a corner.
 */
function addWalls(builder: MeshBuilder, ring: Ring, bottom: number, top: number, facade: boolean): void {
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = distance(a, b);
    if (len < 1e-3) continue;
    const d = normalize(sub(b, a));
    // Right of a CCW edge is the outside; in three space z = -north.
    const normal: Vec3 = [d[1], 0, d[0]];
    const half = len / 2;
    // A half length of 0 tells the shader "no windows here".
    const at = (u: number) => (facade ? [u, i, half] : [0, 0, 0]);
    builder.quad(
      toScene(a, bottom),
      toScene(b, bottom),
      toScene(b, top),
      toScene(a, top),
      normal,
      [
        [perimeter, bottom],
        [perimeter + len, bottom],
        [perimeter + len, top],
        [perimeter, top],
      ],
      { name: FACADE_ATTRIBUTE, values: [at(-half), at(half), at(half), at(-half)] },
    );
    perimeter += len;
  }
}

function addFlatTop(builder: MeshBuilder, outer: Ring, holes: Ring[], height: number): void {
  builder.setAttribute(FACADE_ATTRIBUTE, [0, 0, 0]);
  const { vertices, triangles } = triangulatePolygon({ outer, holes });
  for (const [i, j, k] of triangles) {
    builder.triangle(toScene(vertices[i], height), toScene(vertices[j], height), toScene(vertices[k], height), [0, 1, 0], vertices[i], vertices[j], vertices[k]);
  }
}

function addBox(builder: MeshBuilder, box: Box): void {
  const corners = withOrientation(boxCorners(box), true);
  addWalls(builder, corners, box.bottom, box.top, false);
  addFlatTop(builder, corners, [], box.top);
}

/** Seeded machine room (and maybe a water tank on it), only if it fits inside the parapet. */
function rooftopBoxes(building: Building, roofRing: Ring, roofHeight: number): Box[] {
  if (building.levels <= BUILDING_SPEC.rooftopMinLevels) return [];
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
 * Extruded building with flat normals: facade walls (carrying the window
 * shader attribute), a flush parapet with its cap and inner faces, the roof
 * slab, and seeded rooftop structures on tall buildings.
 */
export function buildBuildingGeometry(building: Building): BuildingMeshData {
  const footprint = withOrientation(cleanRing(building.footprint), true);
  const height = Math.max(building.height, 2.5);
  const parapetHeight = building.levels <= 2 ? BUILDING_SPEC.parapetLow : BUILDING_SPEC.parapetTall;
  const inner = insetRing(footprint, BUILDING_SPEC.parapetInset);
  const rimHeight = inner ? height + parapetHeight : height;

  const builder = new MeshBuilder().defineAttribute(FACADE_ATTRIBUTE, 3);
  addWalls(builder, footprint, 0, rimHeight, true);

  let topHeight = rimHeight;
  if (inner) {
    // Cap of the parapet, then its inner faces looking at the roof.
    addFlatTop(builder, footprint, [withOrientation(inner, false)], rimHeight);
    addWalls(builder, withOrientation(inner, false), height, rimHeight, false);
    addFlatTop(builder, inner, [], height);
    for (const box of rooftopBoxes(building, inner, height)) {
      addBox(builder, box);
      topHeight = Math.max(topHeight, box.top);
    }
  } else {
    addFlatTop(builder, footprint, [], height);
  }

  const c = ringCentroid(footprint);
  const footprintRadius = Math.max(...footprint.map((p) => distance(p, c)));
  return {
    geometry: builder.build(),
    wallHeight: height,
    rimHeight,
    topHeight,
    centre: toScene(c, 0),
    boundingRadius: Math.hypot(footprintRadius, topHeight / 2),
  };
}
