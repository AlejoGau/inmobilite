import { centroid, pointInRing } from "../geo/polygon";
import { distance } from "../geo/vec";
import { seedFromOrigin } from "../seed";
import { MAX_BUILDINGS, type AreaModel, type Building, type LngLat, type Park, type Road, type Vec2 } from "../types";
import { buildLabels, rankStreets } from "./labels";
import type { Poi } from "./tileContext";
import { placeTrees } from "./trees";

/**
 * The last stage of every area pipeline (Overpass, tiles, tiles + GCBA):
 * picks the buildings, names them from the POIs inside, plants the trees and
 * writes labels, stats and credits. Pure and deterministic, so every source
 * ends in the same AreaModel shape and the same rules.
 */

/** POI class of a named building from OSM (see overpassComplement.ts): its name beats a shop's. */
export const BUILDING_POI_CLASS = "building";

/**
 * OpenMapTiles poi classes that mean a shop or a place to eat at street
 * level. A building with one of them inside has a commercial ground floor.
 */
export const COMMERCIAL_POI_CLASSES: ReadonlySet<string> = new Set([
  "shop",
  "grocery",
  "bakery",
  "butcher",
  "alcohol_shop",
  "books",
  "clothing_store",
  "fashion",
  "jewelry",
  "mobile_phone",
  "optician",
  "pharmacy",
  "shoes",
  "hardware",
  "furniture",
  "florist",
  "cafe",
  "restaurant",
  "fast_food",
  "bar",
  "pub",
  "ice_cream",
  "beer",
]);

export interface ComposeAreaInput {
  origin: LngLat;
  radius: number;
  roads: Road[];
  sidewalkIds: ReadonlySet<string>;
  parks: Park[];
  /** Trees mapped in OSM, projected to local meters. */
  mappedTrees: readonly Vec2[];
  /** Any number of buildings; the MAX_BUILDINGS closest are kept. */
  candidates: readonly Building[];
  pois: readonly Poi[];
  /** Data credits, in display order. */
  attributions: readonly string[];
}

export function composeArea(input: ComposeAreaInput): AreaModel {
  const seed = seedFromOrigin(input.origin);
  const buildings = selectBuildings(input.candidates).map((b) => enrichFromPois(b, input.pois));
  const trees = placeTrees({
    seed,
    radius: input.radius,
    mappedTrees: input.mappedTrees,
    roads: input.roads,
    sidewalkIds: input.sidewalkIds,
    buildings,
    parks: input.parks,
  });
  const streets = rankStreets(input.roads);

  return {
    origin: { lng: input.origin.lng, lat: input.origin.lat },
    radius: input.radius,
    seed,
    roads: input.roads,
    buildings,
    parks: input.parks,
    trees,
    labels: buildLabels(streets),
    stats: {
      buildings: buildings.length,
      estimatedHeights: buildings.filter((b) => b.heightSource === "estimated").length,
      streets: streets.map((s) => s.name),
    },
    attribution: input.attributions.join(" · "),
  };
}

/** The MAX_BUILDINGS closest, closest first; ties by id so the input order never matters. */
export function selectBuildings(candidates: readonly Building[]): Building[] {
  return candidates
    .slice()
    .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_BUILDINGS);
}

/**
 * Names and use from the POIs that fall inside any part of the building.
 * A name the building already has (OSM) is kept; otherwise a named OSM
 * building wins over a shop, and among shops the one closest to the
 * building's centroid. Only plain uses become commercial: a civic building
 * with a café inside is still civic.
 */
export function enrichFromPois(building: Building, pois: readonly Poi[]): Building {
  const inside = pois.filter((poi) => building.parts.some((part) => pointInRing(poi.position, part.footprint)));
  if (inside.length === 0) return building;

  const commercial = inside.filter((poi) => COMMERCIAL_POI_CLASSES.has(poi.class));
  const enriched: Building = { ...building };
  if (commercial.length > 0 && (building.use === "residential" || building.use === "other")) enriched.use = "commercial";
  if (!building.name) {
    const center = centroid(building.footprint);
    const named = closestPoi(inside.filter((poi) => poi.class === BUILDING_POI_CLASS), center) ?? closestPoi(commercial, center);
    if (named) enriched.name = named.name;
  }
  return enriched;
}

function closestPoi(pois: readonly Poi[], center: Vec2): Poi | undefined {
  let best: Poi | undefined;
  for (const poi of pois) {
    const d = distance(poi.position, center);
    const bestD = best ? distance(best.position, center) : Infinity;
    if (d < bestD || (d === bestD && best && poi.name < best.name)) best = poi;
  }
  return best;
}
