import { gsap } from "gsap";
import { describe, expect, it } from "vitest";
import { sampleArea } from "../testing/sampleArea";
import { HERO_SPEC, INTRO_START } from "./cameraPose";
import { createDirector, INTRO_DURATION, type DirectorFrame } from "./director";

function distance(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe("director", () => {
  it("is a pure function of t, whatever order it is sampled in", () => {
    const area = sampleArea();
    const reference = createDirector(area);
    const times = [0, 0.5, 1.7, 3.3, 4.9, 6.1, 7.4, 8.2, 10];
    const expected = times.map((t) => reference.sample(t));

    const shuffled = createDirector(area);
    const order = [8, 2, 0, 5, 3, 7, 1, 6, 4, 2, 8, 0];
    for (const i of order) expect(shuffled.sample(times[i])).toEqual(expected[i]);

    // A third, fresh director agrees too (no hidden shared state).
    expect(createDirector(area).sample(4.9)).toEqual(expected[4]);
    reference.dispose();
    shuffled.dispose();
  });

  it("starts high above the corner, top-down and north-up, with nothing revealed", () => {
    const director = createDirector(sampleArea());
    const f = director.sample(0);
    expect(f.camera.target).toEqual([0, 0, 0]);
    expect(f.camera.position[1]).toBeCloseTo(INTRO_START.altitude, 6);
    // Slightly pitched from the south, so north is up on screen.
    expect(f.camera.position[0]).toBeCloseTo(0, 6);
    expect(f.camera.position[2]).toBeGreaterThan(0);
    expect(f.camera.fov).toBeCloseTo(INTRO_START.fovDeg, 6);
    for (const key of ["groundReveal", "roadsReveal", "markingsReveal", "buildingRise", "treesReveal", "labels", "beacon"] as const) {
      expect(f[key]).toBe(0);
    }
    director.dispose();
  });

  it("ends on the hero pose with everything revealed, and holds it", () => {
    const director = createDirector(sampleArea());
    const end = director.sample(INTRO_DURATION);
    const later = director.sample(INTRO_DURATION + 30);
    for (const key of ["groundReveal", "roadsReveal", "markingsReveal", "buildingRise", "treesReveal", "labels", "beacon"] as const) {
      expect(end[key]).toBe(1);
    }
    expect(end.progress).toBe(1);
    expect(later.camera).toEqual(end.camera);
    expect(later.t).toBe(INTRO_DURATION + 30);

    const d = distance(end.camera.position, end.camera.target);
    expect(d).toBeGreaterThanOrEqual(HERO_SPEC.minDistance - 1e-6);
    expect(d).toBeLessThanOrEqual(HERO_SPEC.maxDistance + 1e-6);
    // About 40° below the horizon.
    const elevation = Math.asin((end.camera.position[1] - end.camera.target[1]) / d) * (180 / Math.PI);
    expect(elevation).toBeCloseTo(90 - HERO_SPEC.polarDeg, 6);
    expect(end.camera.fov).toBeCloseTo(HERO_SPEC.fovDeg, 6);
    director.dispose();
  });

  it("clamps negative time to the first frame", () => {
    const director = createDirector(sampleArea());
    const before = director.sample(-5);
    const first = director.sample(0);
    expect(before.camera).toEqual(first.camera);
    expect(before.t).toBe(0);
    director.dispose();
  });

  it("moves the camera smoothly (no jumps between close samples)", () => {
    const director = createDirector(sampleArea());
    let previous: DirectorFrame = director.sample(0);
    const step = 1 / 60;
    let maxJump = 0;
    for (let t = step; t <= INTRO_DURATION; t += step) {
      const frame = director.sample(t);
      maxJump = Math.max(maxJump, distance(frame.camera.position, previous.camera.position));
      previous = frame;
    }
    // ~400 m of travel over 8 s; no single 60 fps frame should move more than a few meters.
    expect(maxJump).toBeLessThan(4);
    director.dispose();
  });

  it("raises buildings from the corner outwards", () => {
    const area = sampleArea();
    const director = createDirector(area);
    const nearest = area.buildings.reduce((a, b, i) => (b.distance < area.buildings[a].distance ? i : a), 0);
    const farthest = area.buildings.reduce((a, b, i) => (b.distance > area.buildings[a].distance ? i : a), 0);
    let sawNearAhead = false;
    for (let t = 0; t <= INTRO_DURATION; t += 0.1) {
      const f = director.sample(t);
      const near = director.buildingRise(nearest, f);
      const far = director.buildingRise(farthest, f);
      expect(near).toBeGreaterThanOrEqual(far - 1e-9);
      if (near > 0.5 && far === 0) sawNearAhead = true;
    }
    expect(sawNearAhead).toBe(true);
    const end = director.sample(INTRO_DURATION);
    area.buildings.forEach((_, i) => expect(director.buildingRise(i, end)).toBe(1));
    area.trees.forEach((_, i) => expect(director.treePop(i, end)).toBe(1));
    director.dispose();
  });

  it("stays off GSAP's global clock, so nothing but sample() moves it and nothing leaks", () => {
    const before = gsap.globalTimeline.getChildren(false, true, true).length;
    const director = createDirector(sampleArea());
    expect(gsap.globalTimeline.getChildren(false, true, true).length).toBe(before);
    const a = director.sample(3);
    gsap.globalTimeline.time(gsap.globalTimeline.time() + 5);
    expect(director.sample(3)).toEqual(a);
  });

  it("is deterministic per area: same origin, same hero shot", () => {
    const a = createDirector(sampleArea()).sample(INTRO_DURATION);
    const b = createDirector(sampleArea()).sample(INTRO_DURATION);
    expect(a).toEqual(b);
    const other = { ...sampleArea(), seed: 987654 };
    const c = createDirector(other).sample(INTRO_DURATION);
    expect(c.camera.position).not.toEqual(a.camera.position);
  });
});
