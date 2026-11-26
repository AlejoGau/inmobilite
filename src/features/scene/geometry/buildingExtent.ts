import type { Building, BuildingPart } from "@/domain/types";

/**
 * The volumes of a building. The contract guarantees at least one part; an
 * area serialised before parts existed (an old cache, a stale fixture) still
 * renders as a single block instead of crashing the scene.
 */
export function partsOf(building: Building): BuildingPart[] {
  return building.parts?.length ? building.parts : [{ footprint: building.footprint, height: building.height }];
}

/**
 * Every corner of every part with that part's own roof height, as
 * [east, north, height]. Framing and bounds built from these follow the real
 * massing: a podium's corners stop at the podium, not at the tower's top.
 */
export function partCorners(building: Building): Array<[number, number, number]> {
  const corners: Array<[number, number, number]> = [];
  for (const part of partsOf(building)) {
    for (const [x, y] of part.footprint) corners.push([x, y, part.height]);
  }
  return corners;
}
