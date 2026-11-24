import type { OverpassWay } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import { MAX_BUILDINGS, type Building, type Ring, type Vec2 } from "../types";
import { centroid, normalizeRing, polygonArea } from "../geo/polygon";
import { length, roundVec, round3 } from "../geo/vec";
import { hashString } from "../seed";
import { resolveHeight, resolveUse } from "./buildingHeight";
import { isClosedWay, projectWay, tagsOf, wayId } from "./osmElements";

/** Footprints smaller than this are mapping noise (bollards, kiosks drawn as areas). */
export const MIN_BUILDING_AREA = 12;

interface Candidate {
  way: OverpassWay;
  footprint: Ring;
  area: number;
  centroid: Vec2;
  distance: number;
}

/**
 * Real OSM footprints, but only the MAX_BUILDINGS closest to the origin:
 * a few accurate buildings read better (and render faster) than a whole
 * block of half-mapped ones.
 */
export function extractBuildings(ways: OverpassWay[], projection: Projection): Building[] {
  const candidates: Candidate[] = [];
  for (const way of ways) {
    const tags = tagsOf(way);
    if (!tags.building || tags.building === "no" || !isClosedWay(way)) continue;
    const ring = normalizeRing(projectWay(way, projection));
    if (!ring) continue;
    const area = polygonArea(ring);
    if (area < MIN_BUILDING_AREA) continue;
    const c = centroid(ring);
    candidates.push({ way, footprint: ring, area, centroid: c, distance: length(c) });
  }

  candidates.sort((a, b) => a.distance - b.distance || a.way.id - b.way.id);
  return candidates.slice(0, MAX_BUILDINGS).map(toBuilding);
}

function toBuilding(c: Candidate): Building {
  const tags = tagsOf(c.way);
  const id = wayId(c.way);
  const seed = hashString(id);
  const use = resolveUse(tags);
  const building: Building = {
    id,
    footprint: c.footprint.map(roundVec),
    ...resolveHeight(tags, use, c.area, seed),
    use,
    area: Math.round(c.area * 10) / 10,
    distance: round3(c.distance),
    seed,
  };
  // Optional keys are only set when present, so the JSON has no `undefined`
  // holes and deep equality across runs stays meaningful.
  if (tags.name) building.name = tags.name;
  return building;
}
