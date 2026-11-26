import type { AreaModel, LngLat, Vec2 } from "../types";
import { DEFAULT_AREA_RADIUS, type OverpassNode, type OverpassResponse } from "../osm/overpass";
import { createProjection, type Projection } from "../geo/projection";
import { extractBuildings } from "./buildings";
import { composeArea } from "./composeArea";
import { sortElements, tagsOf } from "./osmElements";
import { extractParks } from "./parks";
import { extractRoads } from "./roads";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export interface BuildAreaInput {
  origin: LngLat;
  osm: OverpassResponse;
  radius?: number;
}

/**
 * Turns a raw Overpass response into the scene's AreaModel. Pure and
 * deterministic: no clock, no Math.random, element order does not matter.
 */
export function buildArea({ origin, osm, radius = DEFAULT_AREA_RADIUS }: BuildAreaInput): AreaModel {
  const projection = createProjection(origin);
  const { ways, nodes, relations } = sortElements(osm);
  const { roads, sidewalkIds } = extractRoads(ways, projection, radius);

  return composeArea({
    origin,
    radius,
    roads,
    sidewalkIds,
    parks: extractParks(ways, projection, radius, relations),
    mappedTrees: mappedTrees(nodes, projection),
    candidates: extractBuildings(ways, projection, relations),
    // Overpass buildings already carry their OSM names and uses.
    pois: [],
    attributions: [OSM_ATTRIBUTION],
  });
}

/** The natural=tree nodes, projected. */
export function mappedTrees(nodes: readonly OverpassNode[], projection: Projection): Vec2[] {
  return nodes.filter((node) => tagsOf(node).natural === "tree").map((node) => projection.toLocal(node.lon, node.lat));
}
