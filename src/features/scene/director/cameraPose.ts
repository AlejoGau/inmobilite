import { mulberry32, randomBetween } from "@/domain/seed";
import type { AreaModel } from "@/domain/types";

export type Vec3 = [number, number, number];

/**
 * A camera orbiting a target. Bearing follows the map convention (0° looks
 * north, clockwise), and polar is the tilt from straight down, so these
 * numbers can be matched with MapLibre's bearing and pitch.
 */
export interface OrbitPose {
  bearingDeg: number;
  polarDeg: number;
  distance: number;
  target: Vec3;
  fovDeg: number;
}

/**
 * Where the intro starts. Matches the end of the MapLibre flight: centred on
 * the origin, north up, slightly pitched, about 380 m above the ground.
 * MapLibre's default vertical field of view is 36.87°.
 */
export const INTRO_START = {
  altitude: 380,
  pitchDeg: 12,
  bearingDeg: 0,
  fovDeg: 36.87,
} as const;

export const HERO_SPEC = {
  /** Tilt from straight down; 50° means looking 40° below the horizon. */
  polarDeg: 50,
  /** Looking north-east, so the west faces lit by the setting sun face the viewer. */
  bearingDeg: 52,
  bearingJitterDeg: 8,
  fovDeg: 38,
  minDistance: 110,
  maxDistance: 230,
  /** Framing margin around the buildings. */
  padding: 1.12,
  /** How far the target moves from the corner towards the buildings' centre. */
  targetPull: 0.45,
  targetHeight: 4,
  /** Aspect used for framing when the viewport is unknown. */
  defaultAspect: 16 / 10,
} as const;

const DEG = Math.PI / 180;

export function startPose(): OrbitPose {
  return {
    bearingDeg: INTRO_START.bearingDeg,
    polarDeg: INTRO_START.pitchDeg,
    distance: INTRO_START.altitude / Math.cos(INTRO_START.pitchDeg * DEG),
    target: [0, 0, 0],
    fovDeg: INTRO_START.fovDeg,
  };
}

/** Camera position for an orbit pose, in three space (x east, y up, z south). */
export function orbitPosition(bearingDeg: number, polarDeg: number, distance: number, target: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const b = bearingDeg * DEG;
  const p = polarDeg * DEG;
  const horizontal = distance * Math.sin(p);
  // The camera sits behind the target, opposite to where it looks.
  out[0] = target[0] - Math.sin(b) * horizontal;
  out[1] = target[1] + distance * Math.cos(p);
  out[2] = target[2] + Math.cos(b) * horizontal;
  return out;
}

/** Building corners at ground and roof level, in three space. */
function buildingPoints(area: AreaModel): Vec3[] {
  const points: Vec3[] = [];
  for (const b of area.buildings) {
    for (const [x, y] of b.footprint) {
      points.push([x, 0, -y], [x, b.height, -y]);
    }
  }
  return points;
}

/**
 * Smallest distance at which every point fits in the view frustum of a
 * camera with the given orientation, looking at `target`.
 */
export function fitDistance(points: Vec3[], target: Vec3, bearingDeg: number, polarDeg: number, fovDeg: number, aspect: number): number {
  const b = bearingDeg * DEG;
  const p = polarDeg * DEG;
  // Unit vectors of the camera basis.
  const forward: Vec3 = [Math.sin(b) * Math.sin(p), -Math.cos(p), -Math.cos(b) * Math.sin(p)];
  const right: Vec3 = [Math.cos(b), 0, Math.sin(b)];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const tanV = Math.tan((fovDeg * DEG) / 2);
  const tanH = tanV * aspect;
  let needed = 0;
  for (const q of points) {
    const d: Vec3 = [q[0] - target[0], q[1] - target[1], q[2] - target[2]];
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const z = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
    // Point depth is distance + z; it must satisfy |x| <= tanH * depth and |y| <= tanV * depth.
    needed = Math.max(needed, Math.abs(x) / tanH - z, Math.abs(y) / tanV - z);
  }
  return needed;
}

/**
 * The 3/4 hero view at the end of the intro: about 40° down onto the corner,
 * far enough to frame every modelled building, with a small seeded variation
 * of the bearing so two corners do not end on the exact same shot.
 */
export function heroPose(area: AreaModel, aspect: number = HERO_SPEC.defaultAspect): OrbitPose {
  const rng = mulberry32(area.seed ^ 0x2545f491);
  const bearingDeg = HERO_SPEC.bearingDeg + randomBetween(rng, -HERO_SPEC.bearingJitterDeg, HERO_SPEC.bearingJitterDeg);
  const points = buildingPoints(area);

  let target: Vec3 = [0, HERO_SPEC.targetHeight, 0];
  if (points.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, , z] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const pull = HERO_SPEC.targetPull;
    target = [((minX + maxX) / 2) * pull, HERO_SPEC.targetHeight, ((minZ + maxZ) / 2) * pull];
  }

  const fit = points.length ? fitDistance(points, target, bearingDeg, HERO_SPEC.polarDeg, HERO_SPEC.fovDeg, aspect) * HERO_SPEC.padding : 0;
  const distance = Math.min(HERO_SPEC.maxDistance, Math.max(HERO_SPEC.minDistance, fit));
  return { bearingDeg, polarDeg: HERO_SPEC.polarDeg, distance, target, fovDeg: HERO_SPEC.fovDeg };
}
