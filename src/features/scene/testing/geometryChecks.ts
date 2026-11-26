import type { BufferGeometry } from "three";

/** Triangles of a non-indexed geometry, with their stored normal and their winding normal. */
export function* triangles(geometry: BufferGeometry): Generator<{
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  stored: [number, number, number];
  winding: [number, number, number];
  index: number;
}> {
  const pos = geometry.getAttribute("position");
  const nor = geometry.getAttribute("normal");
  for (let i = 0; i < pos.count; i += 3) {
    const a: [number, number, number] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const b: [number, number, number] = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)];
    const c: [number, number, number] = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const winding: [number, number, number] = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    yield { a, b, c, stored: [nor.getX(i), nor.getY(i), nor.getZ(i)], winding, index: i / 3 };
  }
}

export function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Every front face's counter-clockwise winding agrees with its stored normal. */
export function windingMatchesNormals(geometry: BufferGeometry): boolean {
  for (const t of triangles(geometry)) if (dot(t.winding, t.stored) <= 0) return false;
  return true;
}

type P2 = [number, number];

function triangleArea2(poly: P2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** Sutherland-Hodgman: the part of convex `subject` inside convex counter-clockwise `clip`. */
function clipConvex(subject: P2[], clip: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: P2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = inside(p);
      const qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
        const t = d1 / (d1 - d2);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

export interface CoplanarOverlap {
  first: number;
  second: number;
  /** Shared area, m². */
  area: number;
}

/**
 * Pairs of triangles that lie on the same plane (facing either way) and
 * overlap by more than `minArea`: exactly what z-fights. Triangles that only
 * share an edge or a vertex do not count.
 */
export function coplanarOverlaps(geometry: BufferGeometry, minArea = 1e-3, planeTolerance = 1e-3): CoplanarOverlap[] {
  const tris = [...triangles(geometry)].map((t) => {
    const len = Math.hypot(...t.winding);
    const n = t.winding.map((v) => v / len) as [number, number, number];
    // One orientation per plane, so opposite-facing coincident faces meet in the same bucket.
    const major = [0, 1, 2].reduce((m, i) => (Math.abs(n[i]) > Math.abs(n[m]) ? i : m), 0);
    const sign = n[major] < 0 ? -1 : 1;
    const canon = n.map((v) => v * sign) as [number, number, number];
    const offset = dot(canon, t.a);
    // Project on the plane perpendicular to the dominant axis.
    const [u, v] = [0, 1, 2].filter((i) => i !== major);
    const project = (p: number[]): P2 => [p[u], p[v]];
    let poly = [project(t.a), project(t.b), project(t.c)];
    if (triangleArea2(poly) < 0) poly = poly.reverse();
    return { index: t.index, canon, offset, poly, area: len / 2, major };
  });
  const buckets = new Map<string, typeof tris>();
  for (const t of tris) {
    if (t.area < 1e-9) continue;
    const key = `${t.major}:${t.canon.map((v) => Math.round(v * 200)).join(",")}`;
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }
  const overlaps: CoplanarOverlap[] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].offset - list[i].offset <= planeTolerance; j++) {
        if (dot(list[i].canon, list[j].canon) < 1 - 1e-6) continue;
        const shared = clipConvex(list[i].poly, list[j].poly);
        const area = shared.length >= 3 ? Math.abs(triangleArea2(shared)) : 0;
        if (area > minArea) overlaps.push({ first: list[i].index, second: list[j].index, area });
      }
    }
  }
  return overlaps;
}
