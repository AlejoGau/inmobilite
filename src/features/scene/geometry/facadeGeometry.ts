import { BufferGeometry, Float32BufferAttribute } from "three";
import { frontNormal } from "@/domain/area/facade";
import { pointInRing } from "@/domain/geo/polygon";
import type { Building, Vec2 } from "@/domain/types";
import { partsOf } from "./buildingExtent";

/**
 * The real facade photo, draped over a building's street wall as a vertical
 * quad. Pure: BufferGeometry only, tested in node.
 */
export const FACADE_PHOTO_SPEC = {
  /** Out from the wall, so the photo never z-fights the clay facade behind it. */
  offset: 0.06,
  /** Share of each image side cut away: the GCBA watermark and the lens' dark edges live there. */
  crop: 0.03,
  /** When the photo is shorter than the wall, its top fades into the clay over this share of its height... */
  fadeShare: 0.25,
  /** ...but never more than this, in meters. */
  fadeMaxM: 3,
  /** How far inside the wall the part under the front is looked up. */
  probeM: 0.5,
} as const;

export interface FacadeLayout {
  /** Wall length = photo width, in meters. */
  width: number;
  /** Height of the quad: the wall, or the photo's own height if that is shorter. */
  height: number;
  /** Height at which the top fade starts (= height when there is none). */
  fadeFrom: number;
  /** Texture v at the top of the quad. */
  vTop: number;
}

/**
 * Height of the wall the photo goes on: the part right behind the front
 * edge (a podium, not the tower set back behind it), else the building's.
 */
export function frontWallHeight(building: Building, front: readonly [Vec2, Vec2]): number {
  const [a, b] = front;
  const n = frontNormal(front);
  const probe: Vec2 = [(a[0] + b[0]) / 2 - n[0] * FACADE_PHOTO_SPEC.probeM, (a[1] + b[1]) / 2 - n[1] * FACADE_PHOTO_SPEC.probeM];
  let height = 0;
  for (const part of partsOf(building)) {
    if (pointInRing(probe, part.footprint)) height = Math.max(height, part.height);
  }
  return height > 0 ? height : building.height;
}

/**
 * How the photo fits: it fills the wall's width keeping its aspect, and is
 * anchored at the ground, which is what the street-level shots show best and
 * what a visitor recognises. A photo taller than the wall is cut at the top;
 * a shorter one fades into the clay above it, so no stretched rows show.
 */
export function facadeLayout(width: number, wallHeight: number, photoAspect: number): FacadeLayout {
  const { crop, fadeShare, fadeMaxM } = FACADE_PHOTO_SPEC;
  // Same share is cropped on both axes, so the cropped image keeps the aspect.
  const photoHeight = width / Math.max(photoAspect, 1e-3);
  if (photoHeight >= wallHeight) {
    return { width, height: wallHeight, fadeFrom: wallHeight, vTop: crop + (1 - 2 * crop) * (wallHeight / photoHeight) };
  }
  return { width, height: photoHeight, fadeFrom: photoHeight - Math.min(photoHeight * fadeShare, fadeMaxM), vTop: 1 - crop };
}

/**
 * The quad in three space: `front[0]` at u = crop (the viewer's left),
 * `front[1]` at u = 1 - crop, v = crop at the ground. Positions start at
 * y = 0, so scaling the mesh in Y rises it with its building. Vertex colours
 * carry the alpha of the top fade (rgb stays white).
 */
export function buildFacadeGeometry(front: readonly [Vec2, Vec2], wallHeight: number, photoAspect: number): BufferGeometry {
  const [a, b] = front;
  const n = frontNormal(front);
  const { crop, offset } = FACADE_PHOTO_SPEC;
  const layout = facadeLayout(Math.hypot(b[0] - a[0], b[1] - a[1]), wallHeight, photoAspect);

  // Rows of the quad: ground, start of the fade, top (the middle one collapses when there is no fade).
  const rows = [
    { y: 0, v: crop, alpha: 1 },
    { y: layout.fadeFrom, v: crop + (layout.vTop - crop) * (layout.fadeFrom / layout.height), alpha: 1 },
    { y: layout.height, v: layout.vTop, alpha: layout.fadeFrom < layout.height ? 0 : 1 },
  ];
  const corner = (p: Vec2, y: number): [number, number, number] => [p[0] + n[0] * offset, y, -(p[1] + n[1] * offset)];
  const normal: [number, number, number] = [n[0], 0, -n[1]];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const push = (p: Vec2, u: number, row: (typeof rows)[number]) => {
    positions.push(...corner(p, row.y));
    normals.push(...normal);
    uvs.push(u, row.v);
    colors.push(1, 1, 1, row.alpha);
  };
  for (let r = 0; r < rows.length - 1; r++) {
    const lo = rows[r];
    const hi = rows[r + 1];
    if (hi.y - lo.y < 1e-6) continue;
    // Counter-clockwise seen from the street: left-bottom, right-bottom, right-top, then left-top.
    push(a, crop, lo);
    push(b, 1 - crop, lo);
    push(b, 1 - crop, hi);
    push(a, crop, lo);
    push(b, 1 - crop, hi);
    push(a, crop, hi);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
  geometry.computeBoundingSphere();
  return geometry;
}
