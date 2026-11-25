import type { AreaModel, LngLat } from "../types";
import { DEFAULT_AREA_RADIUS, type OverpassResponse } from "../osm/overpass";
import { createProjection } from "../geo/projection";
import { seedFromOrigin } from "../seed";
import { extractBuildings } from "./buildings";
import { buildLabels, rankStreets } from "./labels";
import { sortElements } from "./osmElements";
import { extractParks } from "./parks";
import { extractRoads } from "./roads";
import { placeTrees } from "./trees";

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
  const seed = seedFromOrigin(origin);
  const { ways, nodes, relations } = sortElements(osm);

  const { roads, sidewalkIds } = extractRoads(ways, projection, radius);
  const buildings = extractBuildings(ways, projection, relations);
  const parks = extractParks(ways, projection, radius, relations);
  const trees = placeTrees({ seed, radius, projection, nodes, roads, sidewalkIds, buildings, parks });
  const streets = rankStreets(roads);

  return {
    origin: { lng: origin.lng, lat: origin.lat },
    radius,
    seed,
    roads,
    buildings,
    parks,
    trees,
    labels: buildLabels(streets),
    stats: {
      buildings: buildings.length,
      estimatedHeights: buildings.filter((b) => b.heightSource === "estimated").length,
      streets: streets.map((s) => s.name),
    },
    attribution: OSM_ATTRIBUTION,
  };
}
