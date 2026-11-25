import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountStage, type StageHarness } from "../testing/r3fHarness";
import { DPR_RANGE, QualityController } from "./QualityController";
import type { QualityTier } from "./SceneRuntime";

/** A phone: devicePixelRatio 3, so <Canvas dpr={[1, 2]}> resolves to 2. */
const PHONE_RATIO = 3;

/** What CityStage passes to <Canvas>. */
const CANVAS_CONFIG = { dpr: DPR_RANGE, performance: { min: 0.75 } };

function controller(tier: QualityTier) {
  return createElement(QualityController, { tier, onTierChange: () => {} });
}

describe("QualityController", () => {
  let stage: StageHarness | undefined;

  beforeEach(() => {
    vi.stubGlobal("window", { devicePixelRatio: PHONE_RATIO });
  });

  afterEach(async () => {
    await stage?.unmount();
    stage = undefined;
    vi.unstubAllGlobals();
  });

  it("keeps the low tier at DPR 1 when <Canvas> re-renders and R3F applies dpr={[1, 2]} again", async () => {
    stage = await mountStage(controller("low"), { config: CANVAS_CONFIG });
    expect(stage.store.getState().viewport.dpr).toBe(1);

    // The intro ends (or a building is selected, labels toggle, the window
    // resizes): CityStage re-renders and <Canvas> configures its root again.
    await stage.rerenderCanvas(controller("low"));
    expect(stage.store.getState().viewport.dpr).toBe(1);
    expect(stage.gl.getPixelRatio()).toBe(1);
  });

  it("keeps the low tier at DPR 1 when the display's ratio changes (zoom, another screen)", async () => {
    // R3F follows devicePixelRatio through a resolution media query and applies the Canvas dpr again.
    const ratioChanges: Array<() => void> = [];
    vi.stubGlobal("window", {
      devicePixelRatio: PHONE_RATIO,
      matchMedia: () => ({ addEventListener: (_type: string, onChange: () => void) => ratioChanges.push(onChange), removeEventListener: () => {} }),
    });
    stage = await mountStage(controller("low"), { config: CANVAS_CONFIG });
    expect(ratioChanges.length).toBeGreaterThan(0);

    await stage.act(() => ratioChanges[ratioChanges.length - 1]());
    expect(stage.store.getState().viewport.dpr).toBe(1);
    expect(stage.gl.getPixelRatio()).toBe(1);
  });

  it("gives a phone that started on the low tier its full ratio on the high tier", async () => {
    stage = await mountStage(controller("low"), { config: CANVAS_CONFIG });
    await stage.render(controller("high"));
    // AdaptiveDpr scales from initialDpr, so it must hold the device ratio, not the low tier's 1.
    expect(stage.store.getState().viewport.initialDpr).toBe(2);
    expect(stage.store.getState().viewport.dpr).toBe(2);
  });

  it("settles on DPR 1 when the tier drops back to low, after AdaptiveDpr restores its base on unmount", async () => {
    stage = await mountStage(controller("low"), { config: CANVAS_CONFIG });
    await stage.render(controller("high"));
    await stage.render(controller("low"));
    expect(stage.store.getState().viewport.dpr).toBe(1);
    expect(stage.gl.getPixelRatio()).toBe(1);
  });
});
