import { Matrix4, Vector3 } from "three";
import type { AreaModel } from "@/domain/types";
import { partCorners } from "../geometry/buildingExtent";
import { roofAllowance } from "../geometry/buildingGeometry";

export type Vec3 = [number, number, number];

/** Low dusk sun from the west-north-west. */
export const SUN = {
  /** Compass azimuth the light comes FROM (0 = north, clockwise). */
  azimuthDeg: 292.5,
  elevationDeg: 18,
  /** Distance of the light from its target; only matters for the shadow camera's depth range. */
  distance: 650,
} as const;

/** Region around the corner whose ground, kerbs and trees also get shadows. */
const SHADOW_GROUND_RADIUS = 150;
const SHADOW_TREE_HEIGHT = 12;
const FRUSTUM_MARGIN = 3;

const DEG = Math.PI / 180;

/** Unit vector from the scene towards the sun, in three space (x east, y up, z south). */
export function sunDirection(): Vec3 {
  const az = SUN.azimuthDeg * DEG;
  const el = SUN.elevationDeg * DEG;
  const east = Math.sin(az) * Math.cos(el);
  const north = Math.cos(az) * Math.cos(el);
  return [east, Math.sin(el), -north];
}

export interface ShadowFrustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

/**
 * Height at which the shadow of a caster standing at (x, z) reaches the edge
 * of the ground disc. Anything above it throws its shadow off the model, so
 * the shadow camera need not cover it: at an 18° sun a 75 m tower casts a
 * 230 m shadow, and covering all of it would blur every other shadow.
 */
function heightReachingEdge(x: number, z: number, sun: Vec3, radius: number): number {
  // Solve |p - s * horizontal(sun)| = radius for s >= 0 along the shadow direction.
  const dx = -sun[0];
  const dz = -sun[2];
  const a = dx * dx + dz * dz;
  const b = 2 * (x * dx + z * dz);
  const c = x * x + z * z - radius * radius;
  if (c >= 0) return 0; // the caster itself stands outside the disc
  const s = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return s * sun[1];
}

/** Points the shadow map must cover: every part of every building (and where its shadow lands) plus the nearby ground. */
export function shadowPoints(area: AreaModel, sun: Vec3 = sunDirection()): Vec3[] {
  const points: Vec3[] = [];
  const withTip = (x: number, y: number, z: number) => {
    points.push([x, y, z]);
    // Where this point's shadow lands on the ground: it extends the depth range.
    const k = y / sun[1];
    points.push([x - sun[0] * k, 0, z - sun[2] * k]);
  };
  for (const b of area.buildings) {
    const allowance = roofAllowance(b);
    for (const [x, north, height] of partCorners(b)) {
      points.push([x, 0, -north]);
      const reach = heightReachingEdge(x, -north, sun, area.radius);
      if (reach > 0) withTip(x, Math.min(height + allowance, reach), -north);
    }
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const x = Math.cos(a) * SHADOW_GROUND_RADIUS;
    const z = Math.sin(a) * SHADOW_GROUND_RADIUS;
    points.push([x, 0, z]);
    withTip(x, SHADOW_TREE_HEIGHT, z);
  }
  return points;
}

/**
 * Tight orthographic bounds for a directional light at `sun * distance`
 * looking at `target`: the smallest box, in light space, that holds every
 * point. Tight bounds are what keep a 2048 map crisp over a 300 m disc.
 */
export function fitShadowFrustum(points: Vec3[], sun: Vec3, target: Vec3, distance: number): ShadowFrustum {
  const eye = new Vector3(target[0] + sun[0] * distance, target[1] + sun[1] * distance, target[2] + sun[2] * distance);
  const view = new Matrix4().lookAt(eye, new Vector3(...target), new Vector3(0, 1, 0)).setPosition(eye).invert();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const v = new Vector3();
  for (const p of points) {
    v.set(p[0], p[1], p[2]).applyMatrix4(view);
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  }
  const m = FRUSTUM_MARGIN;
  return {
    left: minX - m,
    right: maxX + m,
    bottom: minY - m,
    top: maxY + m,
    // The camera looks down -z: the nearest point has the largest z.
    near: Math.max(0.5, -maxZ - m),
    far: -minZ + m,
  };
}
