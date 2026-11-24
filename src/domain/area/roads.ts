import type { OverpassWay } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import type { Road, RoadClass } from "../types";
import { clipPolylineToCircle, polylineLength } from "../geo/polyline";
import { roundVec } from "../geo/vec";
import { projectWay, tagsOf, wayId } from "./osmElements";

/** Roads extend this far past the area radius, so they fade out instead of ending at the edge. */
export const ROAD_CLIP_MARGIN = 30;
/** Clipped pieces shorter than this are slivers at the circle edge. */
const MIN_PIECE_LENGTH = 1;

export const ROAD_WIDTHS: Record<RoadClass, number> = {
  primary: 18,
  secondary: 13,
  tertiary: 10,
  residential: 8,
  service: 5,
  pedestrian: 6,
  footway: 2.2,
};

const HIGHWAY_TO_CLASS: Record<string, RoadClass> = {
  // Autopistas and trunk avenues are rare in a 300 m area; draw them as the widest class.
  motorway: "primary",
  trunk: "primary",
  primary: "primary",
  secondary: "secondary",
  tertiary: "tertiary",
  residential: "residential",
  living_street: "residential",
  unclassified: "residential",
  service: "service",
  pedestrian: "pedestrian",
  footway: "footway",
  steps: "footway",
  path: "footway",
  cycleway: "footway",
};

export function roadClassOf(highway: string | undefined): RoadClass | null {
  if (!highway) return null;
  const base = highway.endsWith("_link") ? highway.slice(0, -"_link".length) : highway;
  return HIGHWAY_TO_CLASS[base] ?? null;
}

export interface RoadExtraction {
  roads: Road[];
  /**
   * Ids of footways mapped as sidewalks. Street trees stand ON the sidewalk,
   * so tree placement must not treat these as a surface to avoid.
   */
  sidewalkIds: ReadonlySet<string>;
}

export function extractRoads(ways: OverpassWay[], projection: Projection, radius: number): RoadExtraction {
  const roads: Road[] = [];
  const sidewalkIds = new Set<string>();
  const clipRadius = radius + ROAD_CLIP_MARGIN;
  for (const way of ways) {
    const tags = tagsOf(way);
    // Pedestrian areas are polygons, not centrelines: drawn as a line they would outline a plaza.
    if (tags.area === "yes") continue;
    const cls = roadClassOf(tags.highway);
    if (!cls) continue;

    const pieces = clipPolylineToCircle(projectWay(way, projection), clipRadius).filter(
      (piece) => polylineLength(piece) >= MIN_PIECE_LENGTH,
    );
    pieces.forEach((piece, index) => {
      const road: Road = {
        id: pieces.length === 1 ? wayId(way) : `${wayId(way)}:${index}`,
        cls,
        width: ROAD_WIDTHS[cls],
        points: piece.map(roundVec),
      };
      if (tags.name) road.name = tags.name;
      if (tags.footway === "sidewalk") sidewalkIds.add(road.id);
      roads.push(road);
    });
  }
  return { roads, sidewalkIds };
}

/** Roads that cars drive on; footways do not make an intersection or a kerb. */
export function isVehicular(road: Road): boolean {
  return road.cls !== "footway" && road.cls !== "pedestrian";
}
