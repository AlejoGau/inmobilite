import type { Projection } from "../geo/projection";
import { centroid, normalizeRing } from "../geo/polygon";
import { roundVec } from "../geo/vec";
import type { OverpassResponse } from "../osm/overpass";
import type { Vec2 } from "../types";
import { mappedTrees } from "./buildArea";
import { BUILDING_POI_CLASS } from "./composeArea";
import { isClosedWay, projectWay, sortElements, tagsOf } from "./osmElements";
import type { Poi } from "./tileContext";

export interface OverpassComplement {
  mappedTrees: Vec2[];
  /** One point per named OSM building, at its centroid: composeArea names the building it falls in. */
  buildingPois: Poi[];
}

export const EMPTY_COMPLEMENT: OverpassComplement = { mappedTrees: [], buildingPois: [] };

/** Reads the answer to buildComplementQuery. Deterministic: elements are sorted first. */
export function complementFromOverpass(osm: OverpassResponse, projection: Projection): OverpassComplement {
  const { ways, nodes } = sortElements(osm);
  const buildingPois: Poi[] = [];
  for (const way of ways) {
    const tags = tagsOf(way);
    if (!tags.building || !tags.name || !isClosedWay(way)) continue;
    const ring = normalizeRing(projectWay(way, projection));
    if (ring) buildingPois.push({ name: tags.name, position: roundVec(centroid(ring)), class: BUILDING_POI_CLASS });
  }
  return { mappedTrees: mappedTrees(nodes, projection), buildingPois };
}
