import { intersect } from "@turf/intersect";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import type { OverpassWay } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import type { Park, Ring, Vec2 } from "../types";
import { normalizeRing, polygonArea } from "../geo/polygon";
import { length, roundVec } from "../geo/vec";
import { isClosedWay, projectWay, tagsOf, wayId } from "./osmElements";
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
 * green past the edge of the scene.
 */
export function extractParks(ways: OverpassWay[], projection: Projection, radius: number): Park[] {
  const clipRadius = radius + ROAD_CLIP_MARGIN;
  const clipCircle = circleRing(clipRadius);
  const parks: Park[] = [];

  for (const way of ways) {
    const tags = tagsOf(way);
    if (!isParkTags(tags) || !isClosedWay(way)) continue;
    const ring = normalizeRing(projectWay(way, projection));
    if (!ring) continue;

    const pieces = ring.every((p) => length(p) <= clipRadius) ? [ring] : clipToCircle(ring, clipCircle);
    const valid = pieces.filter((piece) => polygonArea(piece) >= MIN_PARK_AREA);
    valid.forEach((piece, index) => {
      const park: Park = {
        id: valid.length === 1 ? wayId(way) : `${wayId(way)}:${index}`,
        polygon: piece.map(roundVec),
      };
      if (tags.name) park.name = tags.name;
      parks.push(park);
    });
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
