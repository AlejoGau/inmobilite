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
