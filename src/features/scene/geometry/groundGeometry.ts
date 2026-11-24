import type { BufferGeometry } from "three";
import type { Ring } from "@/domain/types";
import { LAYERS } from "../config/palette";
import type { GroundPlan } from "./groundPlan";
import { MeshBuilder, toScene, type Vec3 } from "./meshBuilder";
import { distance, normalize, sub, triangulatePolygon, type PolygonWithHoles } from "./polygon2d";
import { addRibbon } from "./ribbon";
import { endCapExtensions, extendPolyline } from "./roadNetwork";

const UP: Vec3 = [0, 1, 0];

/** Flat filled disc facing up. */
export function buildDiscGeometry(radius: number, height: number, segments = 96): BufferGeometry {
  const builder = new MeshBuilder();
  const centre = toScene([0, 0], height);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    builder.triangle(
      centre,
      toScene([Math.cos(a0) * radius, Math.sin(a0) * radius], height),
      toScene([Math.cos(a1) * radius, Math.sin(a1) * radius], height),
      UP,
    );
  }
  return builder.build();
}

function addPolygonTop(builder: MeshBuilder, polygon: PolygonWithHoles, height: number): void {
  const { vertices, triangles } = triangulatePolygon(polygon);
  for (const [a, b, c] of triangles) {
    const pa = vertices[a];
    const pb = vertices[b];
    const pc = vertices[c];
    builder.triangle(toScene(pa, height), toScene(pb, height), toScene(pc, height), UP, pa, pb, pc);
  }
}

/**
 * Vertical faces along every edge of a ring, looking away from the solid
 * side. Rings follow the CCW-outer / CW-hole convention, so the solid side
 * is always on the left and the face looks right.
 */
function addRingWalls(builder: MeshBuilder, ring: Ring, bottom: number, top: number, skip?: (a: Ring[number], b: Ring[number]) => boolean): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (skip?.(a, b)) continue;
    const d = normalize(sub(b, a));
    // Right of the edge in domain space is (dy, -dx); in three space z = -north.
    const normal: Vec3 = [d[1], 0, d[0]];
    builder.quad(toScene(a, bottom), toScene(b, bottom), toScene(b, top), toScene(a, top), normal);
  }
}

export function buildPolygonsTopGeometry(polygons: PolygonWithHoles[], height: number): BufferGeometry {
  const builder = new MeshBuilder();
  for (const polygon of polygons) addPolygonTop(builder, polygon, height);
  return builder.build();
}

/** Kerb faces between the asphalt and the sidewalk, except along the outer rim of the disc. */
export function buildKerbGeometry(blocks: PolygonWithHoles[], discRadius: number): BufferGeometry {
  const builder = new MeshBuilder();
  const onRim = (p: Ring[number]) => Math.abs(distance(p, [0, 0]) - discRadius) < 0.5;
  for (const block of blocks) {
    for (const ring of [block.outer, ...block.holes]) {
      addRingWalls(builder, ring, LAYERS.asphalt, LAYERS.sidewalk, (a, b) => onRim(a) && onRim(b));
    }
  }
  return builder.build();
}

/** Lawns raised on the plinth, with their own little edge. */
export function buildParkGeometry(parks: PolygonWithHoles[]): BufferGeometry {
  const builder = new MeshBuilder();
  for (const park of parks) {
    addPolygonTop(builder, park, LAYERS.park);
    for (const ring of [park.outer, ...park.holes]) addRingWalls(builder, ring, LAYERS.sidewalk - 0.01, LAYERS.park);
  }
  return builder.build();
}

/** Used only when the ground booleans fail: plain asphalt ribbons over a flat ground. */
export function buildFallbackRoadGeometry(plan: GroundPlan): BufferGeometry {
  const builder = new MeshBuilder();
  const roads = plan.network.roads;
  const caps = endCapExtensions(roads);
  roads.forEach((road, i) => addRibbon(builder, extendPolyline(road.points, caps[i][0], caps[i][1]), road.width / 2, LAYERS.asphalt));
  return builder.build();
}
