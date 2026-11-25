import { describe, expect, it } from "vitest";
import { createStageInteraction } from "./stageInteraction";

describe("stage interaction", () => {
  it("asks to skip the intro on a press while it plays, and lets no click select meanwhile", () => {
    const stage = createStageInteraction();
    expect(stage.clickMaySelect()).toBe(false);
    stage.pointerDown();
    expect(stage.isSkipRequested()).toBe(true);
    expect(stage.clickMaySelect()).toBe(false);
  });

  it("does not let the click of the press that skipped the intro select, though it lands after the hand-over", () => {
    const stage = createStageInteraction();
    stage.pointerDown();
    // The next frame jumps to the end and SceneRoot hands over, about 100 ms
    // before the browser sends the click that ends this press.
    stage.setIntroPlaying(false);
    expect(stage.clickMaySelect()).toBe(false);
  });

  it("lets the next press select once the intro is over", () => {
    const stage = createStageInteraction();
    stage.pointerDown();
    stage.setIntroPlaying(false);
    stage.pointerDown();
    expect(stage.clickMaySelect()).toBe(true);
  });

  it("does not ask to skip on a press after the intro ended by itself", () => {
    const stage = createStageInteraction();
    stage.setIntroPlaying(false);
    stage.pointerDown();
    expect(stage.isSkipRequested()).toBe(false);
    expect(stage.clickMaySelect()).toBe(true);
  });

  it("starts over on a replay: a press skips the new intro and its click does not select", () => {
    const stage = createStageInteraction();
    stage.setIntroPlaying(false);
    stage.pointerDown();
    // A new playId: SceneRoot clears the pending skip and the intro plays again.
    stage.setSkipRequested(false);
    stage.setIntroPlaying(true);
    stage.pointerDown();
    expect(stage.isSkipRequested()).toBe(true);
    stage.setIntroPlaying(false);
    expect(stage.clickMaySelect()).toBe(false);
  });
});
