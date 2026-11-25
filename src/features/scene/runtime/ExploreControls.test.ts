import type { CameraControls } from "@react-three/drei";
import { createElement } from "react";
import { Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import type { AreaModel, Building } from "@/domain/types";
import { createDirector } from "../director/director";
import { mountStage, placeCamera, withRuntime, type StageHarness } from "../testing/r3fHarness";
import { rect, sampleArea } from "../testing/sampleArea";
import { EXPLORE_LIMITS, exploreTargetBounds, ExploreControls, focusFor, type BuildingFocus } from "./ExploreControls";
import { FrameBus } from "./frameBus";

const WIDTH = 800;
const HEIGHT = 500;
const FRAME_STEP = 1 / 60;

/** What CityStage passes to <Canvas>: a regress drops performance to 0.75 for 200 ms. */
const CANVAS_CONFIG = { performance: { min: 0.75 } };

/**
 * Sparse OSM coverage: the 20 closest buildings can reach 170-300 m from the
 * corner. This one sits like way/1509008996 in Mataderos, centred at
 * x = -56, north = 226, well past the ±165 m core of a 300 m area.
 */
function sparseArea(): { area: AreaModel; far: Building } {
  const base = sampleArea();
  const far: Building = { ...base.buildings[1], id: "far", footprint: rect(-66, 216, -46, 236), height: 20, levels: 7, distance: 233 };
  return { area: { ...base, buildings: [...base.buildings, far] }, far };
}

/**
 * The hand-over in a real R3F root: the camera already sits on the director's
 * final pose (SceneDriver put it there), then ExploreControls mounts.
 */
async function handOver(area: AreaModel) {
  const director = createDirector(area, { aspect: WIDTH / HEIGHT });
  const end = director.sample(director.duration);
  const runtime = { director, bus: new FrameBus(end), exploring: true, quality: "high" as const };
  const targetBounds = exploreTargetBounds(area);
  const tree = (focus: BuildingFocus | null) => withRuntime(runtime, createElement(ExploreControls, { targetBounds, focus, regress: true }));

  const stage = await mountStage(null, { width: WIDTH, height: HEIGHT, config: CANVAS_CONFIG });
  placeCamera(stage.store.getState().camera, end.camera);
  await stage.render(tree(null));

  let t = 0;
  return {
    stage,
    end,
    select: (focus: BuildingFocus) => stage.render(tree(focus)),
    async run(seconds: number) {
      for (let i = 0; i < Math.round(seconds / FRAME_STEP); i++) {
        t += FRAME_STEP;
        await stage.frame(t);
      }
    },
    controls: () => stage.store.getState().controls as unknown as CameraControls,
  };
}

describe("ExploreControls", () => {
  let stage: StageHarness | undefined;

  afterEach(async () => {
    await stage?.unmount();
    stage = undefined;
  });

  it("takes over on the director's final pose without moving the camera or lowering the resolution", async () => {
    const explore = await handOver(sampleArea());
    stage = explore.stage;
    await explore.run(5 * FRAME_STEP);

    // A regress here would drop the DPR by a quarter for 200 ms on a static frame.
    expect(stage.store.getState().performance.current).toBe(1);
    const camera = stage.store.getState().camera;
    explore.end.camera.position.forEach((value, axis) => expect(camera.position.getComponent(axis)).toBeCloseTo(value, 6));
  });

  it("frames the centre of a selected building that lies past the core of a sparse area", async () => {
    const { area, far } = sparseArea();
    const explore = await handOver(area);
    stage = explore.stage;
    const focus = focusFor(far);

    await explore.select(focus);
    await explore.run(4);

    const target = explore.controls().getTarget(new Vector3());
    expect(target.distanceTo(new Vector3(...focus.centre))).toBeLessThan(0.5);
  });
});

describe("exploreTargetBounds", () => {
  it("is the core of the area where every building stands near the corner", () => {
    const area = sampleArea();
    const half = area.radius * EXPLORE_LIMITS.targetBoundsFactor;
    const bounds = exploreTargetBounds(area);
    expect(bounds.min.toArray()).toEqual([-half, 0, -half]);
    expect(bounds.max.toArray()).toEqual([half, EXPLORE_LIMITS.targetCeiling, half]);
  });

  it("grows to keep every building's focus centre inside, with room to spare", () => {
    const { area, far } = sparseArea();
    const tower: Building = { ...area.buildings[0], id: "tower", height: 150, levels: 50 };
    const withTower = { ...area, buildings: [...area.buildings, tower] };
    const bounds = exploreTargetBounds(withTower);
    const margin = EXPLORE_LIMITS.targetMargin;
    // The box is symmetric around the corner, so |centre| + margin covers both sides.
    expect(bounds.min.x).toBe(-bounds.max.x);
    expect(bounds.min.z).toBe(-bounds.max.z);
    for (const building of withTower.buildings) {
      const [x, y, z] = focusFor(building).centre;
      expect(Math.abs(x) + margin).toBeLessThanOrEqual(bounds.max.x);
      expect(Math.abs(z) + margin).toBeLessThanOrEqual(bounds.max.z);
      expect(y + margin).toBeLessThanOrEqual(bounds.max.y);
    }
    // The far building widens the box past the core; the tower lifts its top past the ceiling.
    expect(bounds.max.z).toBeGreaterThan(area.radius * EXPLORE_LIMITS.targetBoundsFactor);
    expect(Math.abs(focusFor(far).centre[2]) + margin).toBe(bounds.max.z);
    expect(bounds.max.y).toBe(tower.height / 2 + margin);
  });
});
