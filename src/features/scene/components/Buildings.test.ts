import { createElement } from "react";
import { Raycaster, ShaderLib, Vector2, Vector3, type Mesh, type MeshStandardMaterial, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Building } from "@/domain/types";
import { createDirector } from "../director/director";
import { ringCentroid } from "../geometry/polygon2d";
import { FrameBus } from "../runtime/frameBus";
import { createStageInteraction } from "../runtime/stageInteraction";
import { mountStage, placeCamera, withRuntime } from "../testing/r3fHarness";
import { sampleArea } from "../testing/sampleArea";
import { Buildings } from "./Buildings";

const WIDTH = 800;
const HEIGHT = 500;
const FRAME_STEP = 0.1;

/** The building's live shader uniforms, handed out the way three does when it compiles the material. */
function highlightUniform(mesh: Mesh): { value: number } {
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
  (mesh.material as MeshStandardMaterial).onBeforeCompile(shader, {} as WebGLRenderer);
  return shader.uniforms.uHighlight as { value: number };
}

/**
 * Buildings inside a real R3F root, seen from the hero pose, with R3F's own
 * pointer events. The stage interaction and the `exploring` flag are driven
 * the way CityStage and SceneRoot drive them.
 */
async function mountBuildings() {
  const area = sampleArea();
  const director = createDirector(area, { aspect: WIDTH / HEIGHT });
  const end = director.sample(director.duration);
  const bus = new FrameBus(end);
  const interaction = createStageInteraction();
  const onSelectBuilding = vi.fn<(building: Building | null) => void>();
  const tree = (exploring: boolean) =>
    withRuntime(
      { director, bus, exploring, quality: "high" },
      createElement(Buildings, { area, selectedBuildingId: null, onSelectBuilding, clickMaySelect: interaction.clickMaySelect }),
    );

  const stage = await mountStage(tree(false), { width: WIDTH, height: HEIGHT, pointerEvents: true });
  const { camera, scene } = stage.store.getState();
  // Late in the intro the camera is all but on the hero pose, and every building has risen.
  placeCamera(camera, end.camera);
  await stage.frame(0); // the (fake) render brings the world matrices up to date for raycasting
  const meshes = scene.getObjectByName("buildings")!.children as Mesh[];

  // A pixel where one building is the first thing under the pointer.
  const target = (() => {
    const raycaster = new Raycaster();
    for (let index = 0; index < area.buildings.length; index++) {
      const building = area.buildings[index];
      const [x, north] = ringCentroid(building.footprint);
      const ndc = new Vector3(x, building.height / 2, -north).project(camera);
      if (Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9) continue;
      raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
      if (raycaster.intersectObjects(meshes)[0]?.object !== meshes[index]) continue;
      return { building, index, x: ((ndc.x + 1) / 2) * WIDTH, y: ((1 - ndc.y) / 2) * HEIGHT };
    }
    throw new Error("No building stands clear of the others from the hero pose");
  })();

  let t = end.t;
  return {
    stage,
    interaction,
    onSelectBuilding,
    target,
    /** A press: R3F's listener on the canvas wrapper sees the pointerdown first, then CityStage's. */
    async press(x: number, y: number) {
      await stage.pointer("onPointerDown", x, y);
      interaction.pointerDown();
    },
    async release(x: number, y: number) {
      await stage.pointer("onPointerUp", x, y);
      await stage.pointer("onClick", x, y);
    },
    /** What SceneRoot does once SceneDriver reports the end of the intro. */
    async handOver() {
      interaction.setIntroPlaying(false);
      await stage.render(tree(true));
    },
    /** A new playId: the intro plays again from the start. */
    async replay() {
      interaction.setSkipRequested(false);
      interaction.setIntroPlaying(true);
      await stage.render(tree(false));
    },
    /** Lets the director's clock run, so the highlight eases towards its target. */
    play(seconds: number) {
      for (let i = 0; i < Math.round(seconds / FRAME_STEP); i++) {
        t += FRAME_STEP;
        bus.publish(director.sample(t));
      }
    },
    cursor: () => stage.gl.domElement.style.cursor ?? "",
    highlight: (index: number) => highlightUniform(meshes[index]).value,
  };
}

describe("Buildings", () => {
  let scene: Awaited<ReturnType<typeof mountBuildings>> | undefined;

  afterEach(async () => {
    await scene?.stage.unmount();
    scene = undefined;
  });

  it("does not select the building under the press that skips the intro", async () => {
    scene = await mountBuildings();
    const { x, y, building } = scene.target;

    await scene.press(x, y);
    expect(scene.interaction.isSkipRequested()).toBe(true);
    // The next frame jumps to the end and hands over, about 100 ms before the click arrives.
    await scene.handOver();
    await scene.release(x, y);
    expect(scene.onSelectBuilding).not.toHaveBeenCalled();

    // The next press is a plain click on the building.
    await scene.press(x, y);
    await scene.release(x, y);
    expect(scene.onSelectBuilding).toHaveBeenCalledTimes(1);
    expect(scene.onSelectBuilding).toHaveBeenCalledWith(building);
  });

  it("shows a hover that began during the intro as soon as the intro hands over", async () => {
    scene = await mountBuildings();
    const { x, y, index } = scene.target;

    // R3F reports entering the building once, while the intro still plays: nothing shows yet.
    await scene.stage.pointer("onPointerMove", x, y);
    scene.play(1);
    expect(scene.cursor()).toBe("");
    expect(scene.highlight(index)).toBe(0);

    // After the hand-over the pointer moves within the same building: no new enter event.
    await scene.handOver();
    await scene.stage.pointer("onPointerMove", x + 2, y);
    scene.play(1);
    expect(scene.cursor()).toBe("pointer");
    expect(scene.highlight(index)).toBeGreaterThan(0.5); // eases towards the hover level, 0.55
  });

  it("hides the hover while a replay plays and shows it again at its hand-over", async () => {
    scene = await mountBuildings();
    const { x, y, index } = scene.target;
    await scene.handOver();
    await scene.stage.pointer("onPointerMove", x, y);
    expect(scene.cursor()).toBe("pointer");

    await scene.replay();
    scene.play(1);
    expect(scene.cursor()).toBe("");
    expect(scene.highlight(index)).toBeLessThan(0.01);

    // The pointer never left the building, so R3F still has it booked as hovered.
    await scene.handOver();
    scene.play(1);
    expect(scene.cursor()).toBe("pointer");
    expect(scene.highlight(index)).toBeGreaterThan(0.5);
  });
});
