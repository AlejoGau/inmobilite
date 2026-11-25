import { intersect } from "@turf/intersect";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import type { OverpassRelation, OverpassWay } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import type { Park, Ring, Vec2 } from "../types";
import { normalizeRing, polygonArea } from "../geo/polygon";
import { length, roundVec } from "../geo/vec";
import { isMultipolygon, outerRings } from "./multipolygons";
import { isClosedWay, projectWay, refId, tagsOf, wayId, type Tags } from "./osmElements";
import { ROAD_CLIP_MARGIN } from "./roads";

const PARK_LEISURE = new Set(["park", "garden", "playground"]);
const PARK_LANDUSE = new Set(["grass", "recreation_ground"]);
/** Below this a "park" is a planter; not worth a mesh. */
const MIN_PARK_AREA = 4;
/** Vertices of the polygon that approximates the clip circle. */
const CLIP_CIRCLE_SEGMENTS = 64;

export function isParkTags(tags: Record<string, string>): boolean {
  return PARK_LEISURE.has(tags.leisure ?? "") || PARK_LANDUSE.has(tags.landuse ?? "");
}

/**
 * Parks clipped to the same disc as the roads, so a big park does not spill
 * green past the edge of the scene. Closed ways first, then multipolygon
 * relations (Plaza de Mayo, Plaza San Martín are mapped that way).
 */
export function extractParks(ways: OverpassWay[], projection: Projection, radius: number, relations: OverpassRelation[]): Park[] {
  const clipRadius = radius + ROAD_CLIP_MARGIN;
  const clipCircle = circleRing(clipRadius);
  const parks: Park[] = [];

  /** One Park per piece left after clipping; when there are several, each id gets an index. */
  const addPark = (id: string, tags: Tags, rings: Ring[]): void => {
    const pieces = rings.flatMap((ring) => (ring.every((p) => length(p) <= clipRadius) ? [ring] : clipToCircle(ring, clipCircle)));
    const valid = pieces.filter((piece) => polygonArea(piece) >= MIN_PARK_AREA);
    valid.forEach((piece, index) => {
      const park: Park = { id: valid.length === 1 ? id : `${id}:${index}`, polygon: piece.map(roundVec) };
      if (tags.name) park.name = tags.name;
      parks.push(park);
    });
  };

  const drawnWays = new Set<number>();
  for (const way of ways) {
    const tags = tagsOf(way);
    if (!isParkTags(tags) || !isClosedWay(way)) continue;
    drawnWays.add(way.id);
    const ring = normalizeRing(projectWay(way, projection));
    if (ring) addPark(wayId(way), tags, [ring]);
  }
  for (const relation of relations) {
    const tags = tagsOf(relation);
    if (isParkTags(tags) && isMultipolygon(relation)) {
      addPark(refId(relation), tags, outerRings(relation, projection, drawnWays));
    }
  }
  return parks;
}

/** Intersection with the clip circle. Holes are dropped: the scene draws outer shells only. */
function clipToCircle(ring: Ring, circle: Ring): Ring[] {
  const result = intersect(featureCollection([turfPolygon([closeRing(ring)]), turfPolygon([closeRing(circle)])]));
  if (!result) return [];
  const outers =
    result.geometry.type === "Polygon"
      ? [result.geometry.coordinates[0]]
      : result.geometry.coordinates.map((poly) => poly[0]);
  return outers
    .map((outer) => normalizeRing(outer.map((p): Vec2 => [p[0], p[1]])))
    .filter((r): r is Ring => r !== null);
}

function circleRing(radius: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < CLIP_CIRCLE_SEGMENTS; i++) {
    const a = (i / CLIP_CIRCLE_SEGMENTS) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return ring;
}

function closeRing(ring: Ring): number[][] {
  return [...ring, ring[0]].map((p) => [p[0], p[1]]);
}
