import type { AreaModel } from "@/domain/types";

/**
 * The experience as a pure state machine:
 *
 *   idle ──pick──▶ flying ──(flight ended AND area loaded)──▶ materializing ──introEnded──▶ exploring
 *                    │  ▲                                          ▲                          │
 *            areaFailed retry                                      └──────────replay──────────┘
 *                    ▼  │
 *                   error ──reset──▶ idle
 *
 * The flight and the area request run in parallel; whichever finishes last
 * triggers the materialization. Side effects (fetching, flying the map) live in
 * React and report back through events tagged with ids, so a late answer from a
 * superseded search is ignored instead of corrupting the current one.
 */

export interface Destination {
  label: string;
  secondary?: string;
  lat: number;
  lng: number;
}

export type Phase = "idle" | "flying" | "materializing" | "exploring" | "error";

/** "fly" animates the globe; "instant" lands at once (deep links, reduced motion). */
export type Arrival = "fly" | "instant";

export type AreaStatus = "idle" | "loading" | "ready" | "failed";

export interface ExperienceState {
  phase: Phase;
  destination: Destination | null;
  /** Bumped on every pick. Tags the flight. */
  searchId: number;
  /** Bumped on every pick and every retry. Tags the area request. */
  requestId: number;
  arrival: Arrival;
  flightDone: boolean;
  area: AreaModel | null;
  areaStatus: AreaStatus;
  errorMessage: string | null;
  /** Passed to the stage; bumping it replays the intro from t=0. */
  playId: number;
  showLabels: boolean;
  selectedBuildingId: string | null;
}

export type ExperienceEvent =
  | { type: "pick"; destination: Destination; arrival: Arrival }
  | { type: "flightEnded"; searchId: number }
  | { type: "areaLoaded"; requestId: number; area: AreaModel }
  | { type: "areaFailed"; requestId: number; message: string }
  | { type: "retry" }
  | { type: "introEnded" }
  | { type: "replay" }
  | { type: "toggleLabels" }
  | { type: "selectBuilding"; id: string | null }
  | { type: "reset" };

export function createInitialState(deepLink: Destination | null = null): ExperienceState {
  const idle: ExperienceState = {
    phase: "idle",
    destination: null,
    searchId: 0,
    requestId: 0,
    arrival: "fly",
    flightDone: false,
    area: null,
    areaStatus: "idle",
    errorMessage: null,
    playId: 0,
    showLabels: true,
    selectedBuildingId: null,
  };
  return deepLink ? experienceReducer(idle, { type: "pick", destination: deepLink, arrival: "instant" }) : idle;
}

export function experienceReducer(state: ExperienceState, event: ExperienceEvent): ExperienceState {
  switch (event.type) {
    case "pick":
      return {
        ...state,
        phase: "flying",
        destination: event.destination,
        searchId: state.searchId + 1,
        requestId: state.requestId + 1,
        arrival: event.arrival,
        // An instant arrival has nothing to wait for on the map side.
        flightDone: event.arrival === "instant",
        area: null,
        areaStatus: "loading",
        errorMessage: null,
        selectedBuildingId: null,
      };

    case "flightEnded":
      if (event.searchId !== state.searchId || state.flightDone) return state;
      // The globe keeps flying under the error toast and reports its landing only once,
      // so record it there too: a later retry must not wait for a landing that already happened.
      if (state.phase !== "flying" && state.phase !== "error") return state;
      return materializeIfReady({ ...state, flightDone: true });

    case "areaLoaded":
      if (event.requestId !== state.requestId || state.areaStatus !== "loading") return state;
      return materializeIfReady({ ...state, area: event.area, areaStatus: "ready" });

    case "areaFailed":
      if (event.requestId !== state.requestId || state.areaStatus !== "loading") return state;
      return { ...state, phase: "error", areaStatus: "failed", errorMessage: event.message };

    case "retry":
      if (state.phase !== "error" || !state.destination) return state;
      return {
        ...state,
        phase: "flying",
        requestId: state.requestId + 1,
        areaStatus: "loading",
        errorMessage: null,
      };

    case "introEnded":
      if (state.phase !== "materializing") return state;
      return { ...state, phase: "exploring" };

    case "replay":
      if (state.phase !== "exploring") return state;
      return { ...state, phase: "materializing", playId: state.playId + 1, selectedBuildingId: null };

    case "toggleLabels":
      return { ...state, showLabels: !state.showLabels };

    case "selectBuilding": {
      if (state.phase !== "exploring" && state.phase !== "materializing") return state;
      const exists = event.id === null || state.area?.buildings.some((b) => b.id === event.id);
      if (!exists || event.id === state.selectedBuildingId) return state;
      return { ...state, selectedBuildingId: event.id };
    }

    case "reset":
      // Preferences (labels) survive a new search; everything about the place does not.
      return { ...createInitialState(), searchId: state.searchId, requestId: state.requestId, playId: state.playId, showLabels: state.showLabels };
  }
}

function materializeIfReady(state: ExperienceState): ExperienceState {
  if (!state.flightDone || state.areaStatus !== "ready") return state;
  return { ...state, phase: "materializing", playId: state.playId + 1 };
}

/** True while the 3D stage should be on screen (the map is hidden under it). */
export function isStageVisible(state: ExperienceState): boolean {
  return state.phase === "materializing" || state.phase === "exploring";
}
