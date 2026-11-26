import type { OverpassRelation, OverpassWay } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import { MAX_BUILDINGS, type Building, type Ring, type Vec2 } from "../types";
import { centroid, normalizeRing, polygonArea } from "../geo/polygon";
import { length, roundVec, round3 } from "../geo/vec";
import { hashString } from "../seed";
import { resolveHeight, resolveUse } from "./buildingHeight";
import { isMultipolygon, outerRings } from "./multipolygons";
import { compareRefs, isClosedWay, projectWay, refId, tagsOf, type AreaRef, type Tags } from "./osmElements";

/** Footprints smaller than this are mapping noise (bollards, kiosks drawn as areas). */
export const MIN_BUILDING_AREA = 12;

interface Candidate {
  ref: AreaRef;
  tags: Tags;
  footprint: Ring;
  area: number;
  centroid: Vec2;
  distance: number;
}

function isBuildingTags(tags: Tags): boolean {
  return Boolean(tags.building) && tags.building !== "no";
}

/**
 * Real OSM footprints, but only the MAX_BUILDINGS closest to the origin:
 * a few accurate buildings read better (and render faster) than a whole
 * block of half-mapped ones. Closed ways and multipolygon relations compete
 * on equal terms: landmarks are often mapped as relations.
 */
export function extractBuildings(ways: OverpassWay[], projection: Projection, relations: OverpassRelation[]): Building[] {
  const candidates: Candidate[] = [];
  const drawnWays = new Set<number>();
  for (const way of ways) {
    const tags = tagsOf(way);
    if (!isBuildingTags(tags) || !isClosedWay(way)) continue;
    drawnWays.add(way.id);
    const ring = normalizeRing(projectWay(way, projection));
    if (ring) addCandidate(candidates, way, tags, ring);
  }
  for (const relation of relations) {
    const tags = tagsOf(relation);
    if (!isBuildingTags(tags) || !isMultipolygon(relation)) continue;
    // A Building has one footprint, so the largest outer ring stands for the whole relation.
    const largest = outerRings(relation, projection, drawnWays).reduce<Ring | null>(
      (best, ring) => (best === null || polygonArea(ring) > polygonArea(best) ? ring : best),
      null,
    );
    if (largest) addCandidate(candidates, relation, tags, largest);
  }

  candidates.sort((a, b) => a.distance - b.distance || compareRefs(a.ref, b.ref));
  return candidates.slice(0, MAX_BUILDINGS).map(toBuilding);
}

function addCandidate(candidates: Candidate[], ref: AreaRef, tags: Tags, footprint: Ring): void {
  const area = polygonArea(footprint);
  if (area < MIN_BUILDING_AREA) return;
  const c = centroid(footprint);
  candidates.push({ ref, tags, footprint, area, centroid: c, distance: length(c) });
}

function toBuilding(c: Candidate): Building {
  const tags = c.tags;
  const id = refId(c.ref);
  const seed = hashString(id);
  const use = resolveUse(tags);
  const footprint = c.footprint.map(roundVec);
  const height = resolveHeight(tags, use, c.area, seed);
  const building: Building = {
    id,
    footprint,
    // An OSM way is a single volume: one part, the full footprint at the full height.
    parts: [{ footprint, height: height.height }],
    ...height,
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
