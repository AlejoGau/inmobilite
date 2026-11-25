import type { OverpassLatLon, OverpassMember, OverpassRelation } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import type { Ring } from "../types";
import { normalizeRing } from "../geo/polygon";
import { stitchRings } from "../geo/rings";

export function isMultipolygon(relation: OverpassRelation): boolean {
  return relation.tags?.type === "multipolygon";
}

type OuterMember = OverpassMember & { geometry: OverpassLatLon[] };

/**
 * Outer rings of a multipolygon relation, assembled from its member ways and normalised like a
 * closed way's outline (local meters, CCW, no closing point).
 *
 * Inner rings (courtyards, holes) are ignored for now: the scene draws solid outer shells, as it
 * already does when clipping a park leaves a hole.
 *
 * `drawnWays` holds the closed ways the caller already draws as this kind of feature. An old-style
 * multipolygon tags its outer way too, and that ring must not be drawn twice.
 */
export function outerRings(relation: OverpassRelation, projection: Projection, drawnWays: ReadonlySet<number>): Ring[] {
  // Only explicit outers: an empty-role member may be a hole, and drawing it as an outer would stack a
  // second polygon on the same park.
  const outers = relation.members.filter(
    (m): m is OuterMember => m.type === "way" && m.role === "outer" && m.geometry !== undefined,
  );
  return stitchRings(
    outers.map((m) => m.geometry),
    pointKey,
  )
    .filter(({ parts }) => !(parts.length === 1 && drawnWays.has(outers[parts[0]].ref)))
    .map(({ points }) => normalizeRing(points.map((p) => projection.toLocal(p.lon, p.lat))))
    .filter((ring): ring is Ring => ring !== null);
}

/** Overpass prints a node's coordinates the same in every way that uses it, so they identify shared endpoints. */
function pointKey(p: OverpassLatLon): string {
  return `${p.lat},${p.lon}`;
}
