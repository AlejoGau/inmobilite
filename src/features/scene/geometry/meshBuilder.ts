import { BufferGeometry, Float32BufferAttribute } from "three";
import type { Vec2 } from "@/domain/types";

/** three.js space: x = east, y = up, z = -north. */
export type Vec3 = [number, number, number];

/** Domain [east, north] at a height, in three.js space. */
export function toScene(p: Vec2, height: number): Vec3 {
  return [p[0], height, -p[1]];
}

interface ExtraAttribute {
  itemSize: number;
  data: number[];
  current: number[];
}

/**
 * Accumulates a non-indexed triangle soup with flat normals. Non-indexed on
 * purpose: every face of a maquette has a crisp edge, and the counts here are
 * tiny (a few thousand triangles per layer).
 *
 * Winding is derived from the intended normal, so callers never have to
 * reason about the orientation of their input rings.
 */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly extras = new Map<string, ExtraAttribute>();

  /** Declares a custom float attribute. Its current value applies to every vertex pushed after it. */
  defineAttribute(name: string, itemSize: number, initial: number[] = new Array(itemSize).fill(0)): this {
    this.extras.set(name, { itemSize, data: [], current: [...initial] });
    return this;
  }

  setAttribute(name: string, value: number[]): this {
    const extra = this.extras.get(name);
    if (!extra) throw new Error(`Unknown attribute ${name}`);
    if (value.length !== extra.itemSize) throw new Error(`Attribute ${name} expects ${extra.itemSize} values`);
    extra.current = value;
    return this;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /**
   * Adds a triangle whose front face points along `normal`. `perVertex`
   * overrides one custom attribute vertex by vertex (for values that must
   * interpolate across the face); other attributes use their current value.
   */
  triangle(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    normal: Vec3,
    uvA: Vec2 = [0, 0],
    uvB: Vec2 = [0, 0],
    uvC: Vec2 = [0, 0],
    perVertex?: PerVertexAttribute<3>,
  ): this {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const facing = cx * normal[0] + cy * normal[1] + cz * normal[2];
    if (Math.abs(facing) < 1e-12) return this; // degenerate
    const order = facing > 0 ? ([0, 1, 2] as const) : ([0, 2, 1] as const);
    const points = [a, b, c];
    const uvs = [uvA, uvB, uvC];
    for (const i of order) this.pushVertex(points[i], normal, uvs[i], perVertex && { name: perVertex.name, value: perVertex.values[i] });
    return this;
  }

  /** Adds a planar quad given in loop order (either direction). */
  quad(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    normal: Vec3,
    uvs: [Vec2, Vec2, Vec2, Vec2] = [[0, 0], [0, 0], [0, 0], [0, 0]],
    perVertex?: PerVertexAttribute<4>,
  ): this {
    const pick = (i: number, j: number, k: number): PerVertexAttribute<3> | undefined =>
      perVertex && { name: perVertex.name, values: [perVertex.values[i], perVertex.values[j], perVertex.values[k]] };
    this.triangle(a, b, c, normal, uvs[0], uvs[1], uvs[2], pick(0, 1, 2));
    this.triangle(a, c, d, normal, uvs[0], uvs[2], uvs[3], pick(0, 2, 3));
    return this;
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(this.uvs, 2));
    for (const [name, extra] of this.extras) {
      geometry.setAttribute(name, new Float32BufferAttribute(extra.data, extra.itemSize));
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private pushVertex(p: Vec3, n: Vec3, uv: Vec2, override?: { name: string; value: number[] }): void {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(uv[0], uv[1]);
    for (const [name, extra] of this.extras) {
      const value = override && override.name === name ? override.value : extra.current;
      if (value.length !== extra.itemSize) throw new Error(`Attribute ${name} expects ${extra.itemSize} values`);
      extra.data.push(...value);
    }
  }
}

/** Values of one custom attribute for each vertex of a face, in the order the face was given. */
export interface PerVertexAttribute<N extends 3 | 4> {
  name: string;
  values: N extends 3 ? [number[], number[], number[]] : [number[], number[], number[], number[]];
}
