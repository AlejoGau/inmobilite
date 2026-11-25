import { describe, expect, it } from "vitest";
import type { AreaModel } from "@/domain/types";
import {
  createInitialState,
  experienceReducer,
  isStageVisible,
  type Destination,
  type ExperienceEvent,
  type ExperienceState,
} from "./experienceMachine";

const acoyte: Destination = { label: "Av. Acoyte y Av. Rivadavia", secondary: "Caballito, CABA", lat: -34.6183, lng: -58.43646 };
const callao: Destination = { label: "Av. Corrientes y Av. Callao", lat: -34.6043, lng: -58.3923 };

function makeArea(buildingIds: string[] = ["b1", "b2"]): AreaModel {
  return {
    origin: { lat: acoyte.lat, lng: acoyte.lng },
    radius: 300,
    seed: 1,
    roads: [],
    buildings: buildingIds.map((id, i) => ({
      id,
      footprint: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      height: 12,
      levels: 4,
      heightSource: "estimated",
      use: "residential",
      area: 50,
      distance: i * 10,
      seed: i,
    })),
    parks: [],
    trees: [],
    labels: [],
    stats: { buildings: buildingIds.length, estimatedHeights: buildingIds.length, streets: ["Av. Rivadavia"] },
    attribution: "© OpenStreetMap contributors",
  };
}

function run(events: ExperienceEvent[], from: ExperienceState = createInitialState()): ExperienceState {
  return events.reduce(experienceReducer, from);
}

const pick = (destination = acoyte): ExperienceEvent => ({ type: "pick", destination, arrival: "fly" });

describe("experienceReducer", () => {
  it("starts idle with labels on", () => {
    const state = createInitialState();
    expect(state.phase).toBe("idle");
    expect(state.showLabels).toBe(true);
    expect(isStageVisible(state)).toBe(false);
  });

  it("a pick starts the flight and the area request in parallel", () => {
    const state = run([pick()]);
    expect(state.phase).toBe("flying");
    expect(state.destination).toEqual(acoyte);
    expect(state.flightDone).toBe(false);
    expect(state.areaStatus).toBe("loading");
    expect(state.searchId).toBe(1);
    expect(state.requestId).toBe(1);
  });

  it("materializes only when the flight ended AND the area loaded (area first)", () => {
    const area = makeArea();
    const loaded = run([pick(), { type: "areaLoaded", requestId: 1, area }]);
    expect(loaded.phase).toBe("flying");
    expect(loaded.area).toBe(area);

    const landed = experienceReducer(loaded, { type: "flightEnded", searchId: 1 });
    expect(landed.phase).toBe("materializing");
    expect(landed.playId).toBe(1);
    expect(isStageVisible(landed)).toBe(true);
  });

  it("materializes only when the flight ended AND the area loaded (flight first)", () => {
    const landed = run([pick(), { type: "flightEnded", searchId: 1 }]);
    expect(landed.phase).toBe("flying");
    expect(landed.flightDone).toBe(true);

    const ready = experienceReducer(landed, { type: "areaLoaded", requestId: 1, area: makeArea() });
    expect(ready.phase).toBe("materializing");
  });

  it("goes to exploring when the intro ends, and replay bumps playId", () => {
    const exploring = run([
      pick(),
      { type: "flightEnded", searchId: 1 },
      { type: "areaLoaded", requestId: 1, area: makeArea() },
      { type: "introEnded" },
    ]);
    expect(exploring.phase).toBe("exploring");

    const replay = experienceReducer(exploring, { type: "replay" });
    expect(replay.phase).toBe("materializing");
    expect(replay.playId).toBe(exploring.playId + 1);
  });

  it("ignores introEnded outside materializing", () => {
    const flying = run([pick()]);
    expect(experienceReducer(flying, { type: "introEnded" })).toBe(flying);
  });

  it("ignores answers from a superseded search", () => {
    const second = run([pick(acoyte), pick(callao)]);
    expect(second.searchId).toBe(2);

    const staleArea = experienceReducer(second, { type: "areaLoaded", requestId: 1, area: makeArea() });
    expect(staleArea).toBe(second);
    const staleFlight = experienceReducer(second, { type: "flightEnded", searchId: 1 });
    expect(staleFlight).toBe(second);
    const staleError = experienceReducer(second, { type: "areaFailed", requestId: 1, message: "boom" });
    expect(staleError).toBe(second);
  });

  it("a new search from exploring flies again and clears the selection", () => {
    const exploring = run([
      pick(),
      { type: "flightEnded", searchId: 1 },
      { type: "areaLoaded", requestId: 1, area: makeArea() },
      { type: "introEnded" },
      { type: "selectBuilding", id: "b1" },
    ]);
    expect(exploring.selectedBuildingId).toBe("b1");

    const next = experienceReducer(exploring, pick(callao));
    expect(next.phase).toBe("flying");
    expect(next.selectedBuildingId).toBeNull();
    expect(next.area).toBeNull();
    expect(isStageVisible(next)).toBe(false);
  });

  it("an area failure shows the error; retry refetches without flying again", () => {
    const failed = run([pick(), { type: "flightEnded", searchId: 1 }, { type: "areaFailed", requestId: 1, message: "Overpass no responde" }]);
    expect(failed.phase).toBe("error");
    expect(failed.errorMessage).toBe("Overpass no responde");

    const retrying = experienceReducer(failed, { type: "retry" });
    expect(retrying.phase).toBe("flying");
    expect(retrying.requestId).toBe(2);
    expect(retrying.searchId).toBe(1);
    expect(retrying.flightDone).toBe(true);

    const ready = experienceReducer(retrying, { type: "areaLoaded", requestId: 2, area: makeArea() });
    expect(ready.phase).toBe("materializing");
  });

  it("an error before landing still waits for the flight after a retry", () => {
    const retrying = run([pick(), { type: "areaFailed", requestId: 1, message: "x" }, { type: "retry" }]);
    const ready = experienceReducer(retrying, { type: "areaLoaded", requestId: 2, area: makeArea() });
    expect(ready.phase).toBe("flying");
    expect(experienceReducer(ready, { type: "flightEnded", searchId: 1 }).phase).toBe("materializing");
  });

  it("a landing while the error shows is kept, so a later retry materializes", () => {
    // The globe keeps flying under the toast and lands once; it never announces that landing again.
    const landedInError = run([pick(), { type: "areaFailed", requestId: 1, message: "Sin conexión" }, { type: "flightEnded", searchId: 1 }]);
    expect(landedInError.phase).toBe("error");
    expect(landedInError.errorMessage).toBe("Sin conexión");
    expect(landedInError.flightDone).toBe(true);

    const retrying = experienceReducer(landedInError, { type: "retry" });
    expect(retrying.flightDone).toBe(true);
    const ready = experienceReducer(retrying, { type: "areaLoaded", requestId: 2, area: makeArea() });
    expect(ready.phase).toBe("materializing");
    expect(isStageVisible(ready)).toBe(true);
  });

  it("a landing after a reset is still ignored", () => {
    const abandoned = run([pick(), { type: "areaFailed", requestId: 1, message: "x" }, { type: "reset" }]);
    expect(experienceReducer(abandoned, { type: "flightEnded", searchId: 1 })).toBe(abandoned);
  });

  it("reset goes back to idle, keeps the labels preference and keeps ids monotonic", () => {
    const state = run([pick(), { type: "toggleLabels" }, { type: "areaFailed", requestId: 1, message: "x" }, { type: "reset" }]);
    expect(state.phase).toBe("idle");
    expect(state.destination).toBeNull();
    expect(state.showLabels).toBe(false);
    expect(state.requestId).toBe(1);

    // A late answer for the abandoned search must not resurrect it.
    expect(experienceReducer(state, { type: "areaLoaded", requestId: 1, area: makeArea() })).toBe(state);
    expect(run([pick()], state).requestId).toBe(2);
  });

  it("only selects buildings that exist in the area", () => {
    const exploring = run([
      pick(),
      { type: "flightEnded", searchId: 1 },
      { type: "areaLoaded", requestId: 1, area: makeArea(["b1"]) },
      { type: "introEnded" },
    ]);
    expect(experienceReducer(exploring, { type: "selectBuilding", id: "nope" })).toBe(exploring);
    const selected = experienceReducer(exploring, { type: "selectBuilding", id: "b1" });
    expect(selected.selectedBuildingId).toBe("b1");
    expect(experienceReducer(selected, { type: "selectBuilding", id: null }).selectedBuildingId).toBeNull();
  });

  it("a deep link starts already landed and waits only for the area", () => {
    const state = createInitialState(acoyte);
    expect(state.phase).toBe("flying");
    expect(state.arrival).toBe("instant");
    expect(state.flightDone).toBe(true);
    expect(experienceReducer(state, { type: "areaLoaded", requestId: 1, area: makeArea() }).phase).toBe("materializing");
  });

  it("is deterministic: the same events give the same state", () => {
    const events: ExperienceEvent[] = [pick(), { type: "flightEnded", searchId: 1 }, { type: "areaLoaded", requestId: 1, area: makeArea() }];
    expect(run(events)).toEqual(run(events));
  });
});
