"use client";

import type { AreaModel } from "@/domain/types";
import { groundPlanFor } from "./geometry/groundPlan";

export { CityStage, type CityStageProps } from "./CityStage";
export { INTRO_START, HERO_SPEC } from "./director/cameraPose";
export { INTRO_DURATION } from "./director/director";

/**
 * Optional warm-up: runs the ground polygon booleans (tens of ms on a laptop,
 * more on a phone) ahead of time, e.g. in an idle callback during the map
 * flight, so mounting CityStage does not stall the crossfade. The result is
 * cached per AreaModel object.
 */
export function prewarmCityStage(area: AreaModel): void {
  groundPlanFor(area);
}
