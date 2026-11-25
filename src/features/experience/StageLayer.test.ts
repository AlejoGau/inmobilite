import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AreaModel } from "@/domain/types";
import type { CityStageProps } from "@/features/scene";
import { hasClass, interact, renderForTest, textOf, type TestNode, type TestRoot } from "@/ui/testing/testRenderer";
import { StageLayer } from "./StageLayer";

const loader = vi.hoisted(() => ({ loadSceneModule: vi.fn() }));
vi.mock("./stageLoader", () => ({ loadSceneModule: loader.loadSceneModule }));

const FALLBACK_TITLE = "No pudimos mostrar la maqueta 3D en este dispositivo.";

const area = { buildings: [], roads: [], stats: { buildings: 0, estimatedHeights: 0, streets: [] } } as unknown as AreaModel;

/** Stands in for the real CityStage (three.js cannot run in node). */
function FakeStage({ playId }: CityStageProps) {
  return createElement("canvas", { "aria-label": "Maqueta 3D", "data-play": playId });
}

/** What three.js does without WebGL2: it throws while R3F sets up the renderer. */
function CrashingStage(): never {
  throw new Error("THREE.WebGLRenderer: Error creating WebGL context.");
}

function sceneWith(CityStage: unknown) {
  return { CityStage };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stageProps(overrides: Partial<Parameters<typeof StageLayer>[0]> = {}) {
  return {
    area,
    visible: true,
    playId: 1,
    showLabels: true,
    selectedBuildingId: null,
    onSelectBuilding: () => {},
    onIntroEnd: () => {},
    skipIntro: false,
    ...overrides,
  };
}

const layers = (root: TestRoot) => root.findAll((node) => hasClass(node, "stage-layer"));
const canvases = (root: TestRoot) => root.findAll((node) => node.type === "canvas");

function button(root: TestRoot, label: string): TestNode {
  const [match] = root.findAll((node) => node.type === "button" && textOf(node).includes(label));
  if (!match) throw new Error(`No button "${label}" in: ${root.text()}`);
  return match;
}

beforeEach(() => {
  loader.loadSceneModule.mockReset();
});

describe("StageLayer", () => {
  it("starts the crossfade only once the 3D chunk has loaded", async () => {
    const chunk = deferred<unknown>();
    loader.loadSceneModule.mockReturnValue(chunk.promise);

    const root = await renderForTest(createElement(StageLayer, stageProps()));
    // Mounting the layer starts its @starting-style fade: it must not run on an empty layer.
    expect(layers(root)).toHaveLength(0);

    await interact(() => chunk.resolve(sceneWith(FakeStage)));
    expect(layers(root)).toHaveLength(1);
    expect(canvases(root)).toHaveLength(1);
  });

  it("drops a stage hidden before its chunk arrived, since nothing was on screen to fade out", async () => {
    const chunk = deferred<unknown>();
    loader.loadSceneModule.mockReturnValue(chunk.promise);

    const root = await renderForTest(createElement(StageLayer, stageProps()));
    await root.update(createElement(StageLayer, stageProps({ visible: false })));
    await interact(() => chunk.resolve(sceneWith(FakeStage)));

    expect(layers(root)).toHaveLength(0);
    expect(canvases(root)).toHaveLength(0);
  });

  it("keeps a crash of the 3D scene inside the stage, and ends the intro so the controls appear", async () => {
    loader.loadSceneModule.mockResolvedValue(sceneWith(CrashingStage));
    const onIntroEnd = vi.fn();

    // Resolves (instead of rejecting with the error) only if a boundary caught it.
    const root = await renderForTest(createElement(StageLayer, stageProps({ onIntroEnd })));

    expect(root.text()).toContain(FALLBACK_TITLE);
    expect(button(root, "Reintentar")).toBeDefined();
    expect(onIntroEnd).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback when the 3D chunk fails to download, and Reintentar loads it again", async () => {
    loader.loadSceneModule.mockRejectedValueOnce(new Error("ChunkLoadError")).mockResolvedValueOnce(sceneWith(FakeStage));

    const root = await renderForTest(createElement(StageLayer, stageProps()));
    expect(root.text()).toContain(FALLBACK_TITLE);
    expect(canvases(root)).toHaveLength(0);

    await interact(() => (button(root, "Reintentar").props.onClick as () => void)());

    expect(loader.loadSceneModule).toHaveBeenCalledTimes(2);
    expect(root.text()).not.toContain(FALLBACK_TITLE);
    expect(canvases(root)).toHaveLength(1);
  });

  it("Reintentar after a crash mounts the scene again", async () => {
    let crash = true;
    function FlakyStage(props: CityStageProps) {
      if (crash) throw new Error("Context lost");
      return FakeStage(props);
    }
    loader.loadSceneModule.mockResolvedValue(sceneWith(FlakyStage));

    const root = await renderForTest(createElement(StageLayer, stageProps()));
    expect(root.text()).toContain(FALLBACK_TITLE);

    crash = false;
    await interact(() => (button(root, "Reintentar").props.onClick as () => void)());
    expect(canvases(root)).toHaveLength(1);
  });

  it("a replay while the fallback shows ends that play at once too", async () => {
    loader.loadSceneModule.mockResolvedValue(sceneWith(CrashingStage));
    const onIntroEnd = vi.fn();

    const root = await renderForTest(createElement(StageLayer, stageProps({ onIntroEnd })));
    await root.update(createElement(StageLayer, stageProps({ onIntroEnd, playId: 2 })));

    expect(onIntroEnd).toHaveBeenCalledTimes(2);
  });

  it("a new search tries a failed download again", async () => {
    loader.loadSceneModule.mockRejectedValueOnce(new Error("ChunkLoadError")).mockResolvedValueOnce(sceneWith(FakeStage));

    const root = await renderForTest(createElement(StageLayer, stageProps()));
    expect(root.text()).toContain(FALLBACK_TITLE);

    // "Nueva búsqueda": the layer fades out and unmounts, then the next area arrives.
    await root.update(createElement(StageLayer, stageProps({ visible: false })));
    const [layer] = layers(root);
    await interact(() => (layer.props.onTransitionEnd as (e: unknown) => void)({ target: layer, currentTarget: layer }));
    expect(layers(root)).toHaveLength(0);

    const nextArea = { ...area } as AreaModel;
    await root.update(createElement(StageLayer, stageProps({ area: nextArea })));
    expect(loader.loadSceneModule).toHaveBeenCalledTimes(2);
    expect(canvases(root)).toHaveLength(1);
  });
});
