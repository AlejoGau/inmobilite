import { describe, expect, it } from "vitest";
import type { Vec2 } from "../types";
import { createProjection, haversineMeters } from "./projection";
import { normalizeRing, pointInRing, signedArea } from "./polygon";
import { clipPolylineToCircle, closestPointOnPolyline } from "./polyline";

describe("createProjection", () => {
  const origin = { lat: -34.6183, lng: -58.43646 };
  const projection = createProjection(origin);

  it("maps the origin to [0, 0] and round-trips", () => {
    expect(projection.toLocal(origin.lng, origin.lat)).toEqual([0, 0]);
    const back = projection.toLngLat(projection.toLocal(-58.44, -34.61));
    expect(back.lng).toBeCloseTo(-58.44, 9);
    expect(back.lat).toBeCloseTo(-34.61, 9);
  });

  it("is accurate within 1 km (east = +x, north = +y)", () => {
    const target = { lng: -58.43, lat: -34.612 };
    const [x, y] = projection.toLocal(target.lng, target.lat);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    const truth = haversineMeters(origin, target);
    expect(Math.abs(Math.hypot(x, y) - truth) / truth).toBeLessThan(0.005);
  });
});

describe("normalizeRing", () => {
  it("drops the closing point, duplicates and collinear vertices, and orients CCW", () => {
    const clockwiseClosed: Vec2[] = [[0, 0], [0, 10], [0, 10.02], [5, 10], [10, 10], [10, 0], [0, 0]];
    const ring = normalizeRing(clockwiseClosed)!;
    expect(ring).toHaveLength(4);
    expect(signedArea(ring)).toBeCloseTo(100, 1);
  });

  it("rejects degenerate rings", () => {
    expect(normalizeRing([[0, 0], [1, 0], [2, 0], [0, 0]])).toBeNull();
  });

  it("tests point inclusion", () => {
    const square: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(pointInRing([2, 2], square)).toBe(true);
    expect(pointInRing([5, 2], square)).toBe(false);
  });
});

describe("polylines", () => {
  it("splits a line that leaves and re-enters the circle, ending on the circle", () => {
    // A U-shape that exits the disc on its right arm and comes back.
    const line: Vec2[] = [[-5, -5], [-5, 20], [5, 20], [5, -5]];
    const pieces = clipPolylineToCircle(line, 10);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      for (const p of piece) expect(Math.hypot(...p)).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(Math.hypot(...pieces[0][pieces[0].length - 1])).toBeCloseTo(10, 9);
  });

  it("finds the closest point on a polyline", () => {
    const closest = closestPointOnPolyline([3, 4], [[0, 0], [10, 0]]);
    expect(closest.point).toEqual([3, 0]);
    expect(closest.distance).toBe(4);
  });
});
