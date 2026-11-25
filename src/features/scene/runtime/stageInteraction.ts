/**
 * Bridge between CityStage's DOM wrapper, which sees every press on the
 * stage, and the scene inside the Canvas. While the intro plays, a press on
 * the stage skips it and clicks never select.
 */
export interface StageInteraction {
  setIntroPlaying(playing: boolean): void;
  setSkipRequested(skip: boolean): void;
  isSkipRequested(): boolean;
  /** Every press on the stage (pointerdown), which always comes before its click. */
  pointerDown(): void;
  /**
   * Whether the click that ends the current press may select a building, or
   * clear the selection. Never while the intro plays, and never for the press
   * that skipped it: that click lands about 100 ms after the press, once the
   * hand-over it triggered has already happened.
   */
  clickMaySelect(): boolean;
}

/** Plain closures, so the methods can be handed around as callbacks. */
export function createStageInteraction(): StageInteraction {
  let introPlaying = true;
  let skipRequested = false;
  // Per press: every press overwrites it, so it can never go stale.
  let pressBeganInIntro = false;
  return {
    setIntroPlaying: (playing) => {
      introPlaying = playing;
    },
    setSkipRequested: (skip) => {
      skipRequested = skip;
    },
    isSkipRequested: () => skipRequested,
    pointerDown: () => {
      pressBeganInIntro = introPlaying;
      if (introPlaying) skipRequested = true;
    },
    clickMaySelect: () => !introPlaying && !pressBeganInIntro,
  };
}
