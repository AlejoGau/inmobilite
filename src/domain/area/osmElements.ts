import type { OverpassElement, OverpassNode, OverpassResponse, OverpassWay } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import type { Vec2 } from "../types";

export type Tags = Record<string, string>;

export interface SortedElements {
  ways: OverpassWay[];
  nodes: OverpassNode[];
}

/**
 * Splits the response into ways and nodes, sorted by id. Overpass already
 * returns a stable order, but sorting makes the model independent of it:
 * the same data from two mirrors must produce the same scene.
 */
export function sortElements(osm: OverpassResponse): SortedElements {
  const ways: OverpassWay[] = [];
  const nodes: OverpassNode[] = [];
  for (const el of osm.elements as OverpassElement[]) {
    if (el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 2) ways.push(el);
    else if (el.type === "node") nodes.push(el);
  }
  ways.sort((a, b) => a.id - b.id);
  nodes.sort((a, b) => a.id - b.id);
  return { ways, nodes };
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
  return `way/${way.id}`;
}

export function tagsOf(el: { tags?: Tags }): Tags {
  return el.tags ?? {};
}
