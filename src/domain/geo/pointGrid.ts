import type { Vec2 } from "../types";
import { distance } from "./vec";

/**
 * Hash grid of points for minimum-spacing checks (tree placement).
 * Queries look at the 3x3 neighbourhood, so the radius must not exceed the cell size.
 */
export class PointGrid {
  private readonly cells = new Map<string, Vec2[]>();

  constructor(private readonly cellSize: number) {}

  add(p: Vec2): void {
    const key = this.key(Math.floor(p[0] / this.cellSize), Math.floor(p[1] / this.cellSize));
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(p);
    else this.cells.set(key, [p]);
  }

  hasWithin(p: Vec2, radius: number): boolean {
    const cx = Math.floor(p[0] / this.cellSize);
    const cy = Math.floor(p[1] / this.cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(this.key(cx + dx, cy + dy));
        if (bucket?.some((q) => distance(p, q) < radius)) return true;
      }
    }
    return false;
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }
}
