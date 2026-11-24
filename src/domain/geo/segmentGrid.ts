import type { Vec2 } from "../types";
import { distanceToSegment } from "./polyline";

export interface IndexedSegment<T> {
  a: Vec2;
  b: Vec2;
  data: T;
}

/**
 * Uniform grid over line segments, for "is this point near a road?" queries.
 * Tree placement asks thousands of them; scanning every road segment each
 * time would blow the 300 ms budget on dense neighbourhoods.
 */
export class SegmentGrid<T> {
  private readonly cells = new Map<string, IndexedSegment<T>[]>();
  /** Largest padding any query may use; segments are registered that far out. */
  private readonly maxQueryRadius: number;

  constructor(
    private readonly cellSize: number,
    maxQueryRadius: number,
  ) {
    this.maxQueryRadius = maxQueryRadius;
  }

  insert(a: Vec2, b: Vec2, data: T): void {
    const segment: IndexedSegment<T> = { a, b, data };
    const pad = this.maxQueryRadius;
    const minX = this.cell(Math.min(a[0], b[0]) - pad);
    const maxX = this.cell(Math.max(a[0], b[0]) + pad);
    const minY = this.cell(Math.min(a[1], b[1]) - pad);
    const maxY = this.cell(Math.max(a[1], b[1]) + pad);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const key = `${cx},${cy}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(segment);
        else this.cells.set(key, [segment]);
      }
    }
  }

  /**
   * True if some segment passes `test`, given the point's distance to it.
   * Only segments within maxQueryRadius are guaranteed to be visited.
   */
  some(p: Vec2, test: (distance: number, data: T) => boolean): boolean {
    const bucket = this.cells.get(`${this.cell(p[0])},${this.cell(p[1])}`);
    if (!bucket) return false;
    for (const s of bucket) {
      if (test(distanceToSegment(p, s.a, s.b), s.data)) return true;
    }
    return false;
  }

  private cell(v: number): number {
    return Math.floor(v / this.cellSize);
  }
}
