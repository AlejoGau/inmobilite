import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/acoyte-rivadavia.overpass.json";
import type {
  OverpassElement,
  OverpassLatLon,
  OverpassMember,
  OverpassRelation,
  OverpassResponse,
  OverpassWay,
} from "../osm/overpass";
import { MAX_BUILDINGS, type AreaModel } from "../types";
import { createProjection } from "../geo/projection";
import { pointInRing, polygonArea } from "../geo/polygon";
import { buildArea } from "./buildArea";

const ORIGIN = { lat: -34.6183, lng: -58.43646 };
const projection = createProjection(ORIGIN);

/** A point given in local meters, at the 7-decimal precision Overpass prints. */
function at(x: number, y: number): OverpassLatLon {
  const { lat, lng } = projection.toLngLat([x, y]);
  return { lat: Number(lat.toFixed(7)), lon: Number(lng.toFixed(7)) };
}

function way(ref: number, role: string, geometry: OverpassLatLon[]): OverpassMember {
  return { type: "way", ref, role, geometry };
}

/** Like Overpass `out geom`: the member ways are untagged and only reachable through the relation. */
function multipolygon(id: number, tags: Record<string, string>, members: OverpassMember[]): OverpassRelation {
  return { type: "relation", id, tags: { type: "multipolygon", ...tags }, members };
}

function closedWay(id: number, tags: Record<string, string>, geometry: OverpassLatLon[]): OverpassWay {
  return { type: "way", id, tags, nodes: geometry.map((_, i) => id * 100 + (i % (geometry.length - 1))), geometry };
}

function square(cx: number, cy: number, half: number): OverpassLatLon[] {
  return [at(cx - half, cy - half), at(cx + half, cy - half), at(cx + half, cy + half), at(cx - half, cy + half), at(cx - half, cy - half)];
}

const build = (...elements: OverpassElement[]): AreaModel => buildArea({ origin: ORIGIN, osm: { elements } });

// Plaza de Mayo's outer ring is split across 8 untagged ways; this one across 3, the middle one reversed.
const [A, B, C, D] = [at(-30, -20), at(30, -20), at(30, 20), at(-30, 20)];
const PLAZA = multipolygon(900, { leisure: "park", name: "Plaza de Prueba" }, [
  way(1, "outer", [A, B, C]),
  way(2, "outer", [D, C]),
  way(3, "outer", [D, A]),
]);

// Palacio de Aguas Corrientes: an untagged outer and an inner courtyard, the tags on the relation.
const PALACIO = multipolygon(901, { building: "public", "building:levels": "2", name: "Palacio de Prueba" }, [
  way(10, "outer", square(0, 0, 15)),
  way(11, "inner", square(0, 0, 5)),
]);

describe("multipolygon relations", () => {
  it("assembles a park whose outer ring is split across several ways", () => {
    const model = build(PLAZA);
    expect(model.parks).toHaveLength(1);
    const [park] = model.parks;
    expect(park).toMatchObject({ id: "relation/900", name: "Plaza de Prueba" });
    expect(polygonArea(park.polygon)).toBeCloseTo(60 * 40, -1);
    expect(pointInRing([0, 0], park.polygon)).toBe(true);
    expect(model.trees.some((t) => pointInRing(t.position, park.polygon))).toBe(true);
  });

  it("models a building relation from its outer ring, ignoring the courtyard for now", () => {
    const [building] = build(PALACIO).buildings;
    expect(building).toMatchObject({ id: "relation/901", name: "Palacio de Prueba", levels: 2, heightSource: "osm", use: "civic" });
    expect(building.area).toBeCloseTo(30 * 30, -1);
  });

  it("keeps the largest outer ring as the footprint of a building with several", () => {
    const twoWings = multipolygon(904, { building: "yes" }, [
      way(40, "outer", square(-40, 0, 5)),
      way(41, "outer", square(40, 0, 10)),
    ]);
    const buildings = build(twoWings).buildings;
    expect(buildings.map((b) => b.id)).toEqual(["relation/904"]);
    expect(buildings[0].area).toBeCloseTo(20 * 20, -1);
  });

  it("counts relation buildings when picking the closest MAX_BUILDINGS", () => {
    const osm = fixture as unknown as OverpassResponse;
    const plain = buildArea({ origin: ORIGIN, osm });
    const withPalacio = buildArea({ origin: ORIGIN, osm: { ...osm, elements: [...osm.elements, PALACIO] } });
    expect(withPalacio.buildings).toHaveLength(MAX_BUILDINGS);
    expect(withPalacio.buildings[0].id).toBe("relation/901");
    expect(withPalacio.buildings.slice(1)).toEqual(plain.buildings.slice(0, MAX_BUILDINGS - 1));
  });

  it("does not draw an old-style multipolygon twice when its outer way carries the tags too", () => {
    const outline = closedWay(77, { building: "yes" }, square(0, 0, 10));
    const oldStyle = multipolygon(902, { building: "yes" }, [way(77, "outer", outline.geometry)]);
    expect(build(outline, oldStyle).buildings.map((b) => b.id)).toEqual(["way/77"]);
  });

  it("drops a ring that does not close, rather than drawing it half open", () => {
    const broken = multipolygon(903, { leisure: "park" }, [way(1, "outer", [A, B, C]), way(3, "outer", [D, A])]);
    expect(build(broken).parks).toEqual([]);
  });

  it("ignores relations that are not multipolygons", () => {
    const site = { ...PLAZA, id: 905, tags: { type: "site", leisure: "park" } };
    expect(build(site).parks).toEqual([]);
  });

  it("stays independent of the element order", () => {
    const elements = [PLAZA, PALACIO, ...(fixture as unknown as OverpassResponse).elements];
    expect(build(...[...elements].reverse())).toEqual(build(...elements));
  });
});
