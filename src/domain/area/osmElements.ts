import type { OverpassElement, OverpassNode, OverpassRelation, OverpassResponse, OverpassWay } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import type { Vec2 } from "../types";

export type Tags = Record<string, string>;

export interface SortedElements {
  ways: OverpassWay[];
  nodes: OverpassNode[];
  relations: OverpassRelation[];
}

/**
 * Splits the response into ways, nodes and relations, sorted by id. Overpass
 * already returns a stable order, but sorting makes the model independent of
 * it: the same data from two mirrors must produce the same scene.
 */
export function sortElements(osm: OverpassResponse): SortedElements {
  const ways: OverpassWay[] = [];
  const nodes: OverpassNode[] = [];
  const relations: OverpassRelation[] = [];
  for (const el of osm.elements as OverpassElement[]) {
    if (el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 2) ways.push(el);
    else if (el.type === "node") nodes.push(el);
    else if (el.type === "relation" && Array.isArray(el.members)) relations.push(el);
  }
  ways.sort((a, b) => a.id - b.id);
  nodes.sort((a, b) => a.id - b.id);
  relations.sort((a, b) => a.id - b.id);
  return { ways, nodes, relations };
}

/** An OSM element that outlines an area. Way 5 and relation 5 are different elements. */
export interface AreaRef {
  type: "way" | "relation";
  id: number;
}

/** "way/123" or "relation/456": the ids the model ships, unique across element types. */
export function refId(ref: AreaRef): string {
  return `${ref.type}/${ref.id}`;
}

/** A stable tie-breaker: ways before relations, then by id. */
export function compareRefs(a: AreaRef, b: AreaRef): number {
  if (a.type !== b.type) return a.type === "way" ? -1 : 1;
  return a.id - b.id;
}

export function projectWay(way: OverpassWay, projection: Projection): Vec2[] {
  return way.geometry.map((p) => projection.toLocal(p.lon, p.lat));
}

export function isClosedWay(way: OverpassWay): boolean {
  const { nodes, geometry } = way;
  if (nodes.length >= 4 && nodes[0] === nodes[nodes.length - 1]) return true;
  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  return geometry.length >= 4 && first.lat === last.lat && first.lon === last.lon;
}

export function wayId(way: OverpassWay): string {
  return refId(way);
}

export function tagsOf(el: { tags?: Tags }): Tags {
  return el.tags ?? {};
}
