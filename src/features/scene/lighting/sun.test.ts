import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { sampleArea } from "../testing/sampleArea";
import { buildTreeGeometry } from "../geometry/treeGeometry";
import { fitShadowFrustum, shadowPoints, SUN, sunDirection } from "./sun";

describe("sun", () => {
  it("comes from the west-north-west, low on the horizon", () => {
    const [x, y, z] = sunDirection();
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    expect(x).toBeLessThan(0); // west
    expect(z).toBeLessThan(0); // north is -z
    expect(Math.abs(x)).toBeGreaterThan(Math.abs(z)); // more west than north
    expect(Math.asin(y) * (180 / Math.PI)).toBeCloseTo(SUN.elevationDeg, 9);
  });

  it("fits the shadow camera tightly around every caster and its shadow", () => {
    const sun = sunDirection();
    const points = shadowPoints(sampleArea(), sun);
    const f = fitShadowFrustum(points, sun, [0, 0, 0], SUN.distance);
    const eye = new Vector3(sun[0] * SUN.distance, sun[1] * SUN.distance, sun[2] * SUN.distance);
    const view = new Matrix4().lookAt(eye, new Vector3(0, 0, 0), new Vector3(0, 1, 0)).setPosition(eye).invert();
    for (const p of points) {
      const v = new Vector3(...p).applyMatrix4(view);
      expect(v.x).toBeGreaterThanOrEqual(f.left);
      expect(v.x).toBeLessThanOrEqual(f.right);
      expect(v.y).toBeGreaterThanOrEqual(f.bottom);
      expect(v.y).toBeLessThanOrEqual(f.top);
      expect(-v.z).toBeGreaterThanOrEqual(f.near);
      expect(-v.z).toBeLessThanOrEqual(f.far);
    }
    // Tight: a 2048 map over this box stays well under 20 cm per texel.
    expect((f.right - f.left) / 2048).toBeLessThan(0.2);
    expect(f.near).toBeGreaterThan(0);
  });

  it("covers the top of a 75 m tower: the bounds follow each part, not the footprint", () => {
    const points = shadowPoints(sampleArea());
    const tallest = Math.max(...points.map((p) => p[1]));
    // The sample's podium-and-tower reaches 78.4 m with its machine room; its shadow lands on the model.
    expect(tallest).toBeGreaterThanOrEqual(78.4);
    // The podium's street-front corners are covered at the podium's own height, not lifted to the tower's.
    expect(points.some(([x, y, z]) => x === -80 && z === -20 && Math.abs(y - 8.4 - 1) < 1e-6)).toBe(true);
  });
});

describe("tree geometry", () => {
  it("merges trunk and crowns into one coloured mesh standing on y = 0", () => {
    const geometry = buildTreeGeometry();
    expect(geometry.getAttribute("color")).toBeDefined();
    expect(geometry.index).toBeNull();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(geometry.boundingBox!.max.y).toBeGreaterThan(6);
    // Cheap enough to instance hundreds of times.
    expect(geometry.getAttribute("position").count / 3).toBeLessThan(250);
  });
});
