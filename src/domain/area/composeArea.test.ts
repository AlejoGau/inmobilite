import { describe, expect, it } from "vitest";
import { pointInRing } from "../geo/polygon";
import { MAX_BUILDINGS, type Building, type Ring, type Road, type Vec2 } from "../types";
import { BUILDING_POI_CLASS, composeArea, enrichFromPois, selectBuildings, type ComposeAreaInput } from "./composeArea";
import type { Poi } from "./tileContext";

const ORIGIN = { lat: -34.6183, lng: -58.43646 };

function square(cx: number, cy: number, half: number): Ring {
  return [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ];
}

function building(id: string, cx: number, cy: number, extra: Partial<Building> = {}): Building {
  const footprint = square(cx, cy, 5);
  return {
    id,
    footprint,
    parts: [{ footprint, height: 12 }],
    height: 12,
    levels: 4,
    heightSource: "gcba",
    use: "residential",
    area: 100,
    distance: Math.hypot(cx, cy),
    seed: 1,
    ...extra,
  };
}

const poi = (name: string, position: Vec2, cls: string): Poi => ({ name, position, class: cls });

const ROADS: Road[] = [
  { id: "r1", name: "Avenida Rivadavia", cls: "primary", width: 18, points: [[-200, 0], [200, 0]] },
  { id: "r2", name: "Avenida Acoyte", cls: "secondary", width: 13, points: [[0, -200], [0, 200]] },
];

function input(overrides: Partial<ComposeAreaInput> = {}): ComposeAreaInput {
  return {
    origin: ORIGIN,
    radius: 300,
    roads: ROADS,
    sidewalkIds: new Set(),
    parks: [],
    mappedTrees: [],
    candidates: [],
    pois: [],
    attributions: ["© OpenStreetMap contributors", "OpenFreeMap"],
    ...overrides,
  };
}

describe("selectBuildings", () => {
  it("keeps the MAX_BUILDINGS closest, closest first, whatever the input order", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => building(`b${i}`, 30 + i * 12, 30));
    const picked = selectBuildings(candidates.slice().reverse());
    expect(picked).toHaveLength(MAX_BUILDINGS);
    expect(picked.map((b) => b.id)).toEqual(candidates.slice(0, MAX_BUILDINGS).map((b) => b.id));
  });

  it("breaks distance ties by id", () => {
    const [a, b] = [building("b", 30, 30), building("a", -30, 30)];
    expect(selectBuildings([a, b]).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("enrichFromPois", () => {
  // Two parts: a podium at (30, 30) and a tower next to it at (40, 30).
  const twoParts = building("p", 30, 30, {
    footprint: [[25, 25], [45, 25], [45, 35], [25, 35]],
    parts: [
      { footprint: square(30, 30, 5), height: 9 },
      { footprint: square(40, 30, 5), height: 40 },
    ],
  });

  it("names the building after a shop inside any of its parts and makes it commercial", () => {
    const enriched = enrichFromPois(twoParts, [poi("Café Acoyte", [41, 31], "cafe"), poi("Lejos", [100, 100], "shop")]);
    expect(enriched.name).toBe("Café Acoyte");
    expect(enriched.use).toBe("commercial");
  });

  it("prefers the shop closest to the centroid, and a named OSM building over any shop", () => {
    const shops = [poi("Kiosco", [44, 34], "shop"), poi("Farmacia", [36, 30], "pharmacy")];
    expect(enrichFromPois(twoParts, shops).name).toBe("Farmacia");
    expect(enrichFromPois(twoParts, [...shops, poi("Edificio Rivadavia", [26, 26], BUILDING_POI_CLASS)]).name).toBe("Edificio Rivadavia");
  });

  it("keeps an existing name and a civic use, and ignores POIs that are not shops for the use", () => {
    const civic = { ...twoParts, name: "Escuela", use: "civic" as const };
    expect(enrichFromPois(civic, [poi("Café", [30, 30], "cafe")])).toEqual(civic);
    const withPark = enrichFromPois(twoParts, [poi("Plaza", [30, 30], "park")]);
    expect(withPark.use).toBe("residential");
    expect(withPark.name).toBeUndefined();
  });

  it("returns the very same building when no POI falls inside", () => {
    expect(enrichFromPois(twoParts, [poi("Lejos", [100, 100], "shop")])).toBe(twoParts);
  });
});

describe("composeArea", () => {
  const tower = building("t", 30, 30, {
    footprint: [[25, 25], [45, 25], [45, 35], [25, 35]],
    parts: [
      { footprint: square(30, 30, 5), height: 9 },
      { footprint: square(40, 30, 5), height: 40 },
    ],
  });
  const estimated = building("e", -40, 40, { heightSource: "estimated" });

  it("assembles labels, stats and the joined attribution", () => {
    const model = composeArea(input({ candidates: [tower, estimated] }));
    expect(model.stats).toEqual({ buildings: 2, estimatedHeights: 1, streets: ["Avenida Acoyte", "Avenida Rivadavia"] });
    expect(model.labels.map((l) => l.name).sort()).toEqual(["Avenida Acoyte", "Avenida Rivadavia"]);
    expect(model.attribution).toBe("© OpenStreetMap contributors · OpenFreeMap");
    expect(model.radius).toBe(300);
    expect(model.origin).toEqual(ORIGIN);
  });

  it("plants mapped trees but never inside a building part", () => {
    const inTower: Vec2 = [41, 31];
    const free: Vec2 = [60, 60];
    const model = composeArea(input({ candidates: [tower], mappedTrees: [inTower, free] }));
    const positions = model.trees.map((t) => t.position);
    expect(positions).toContainEqual(free);
    expect(positions).not.toContainEqual(inTower);
    for (const p of positions) for (const part of tower.parts) expect(pointInRing(p, part.footprint)).toBe(false);
  });

  it("is deterministic and independent of the input order", () => {
    const pois = [poi("Café", [41, 31], "cafe"), poi("Bar", [-40, 40], "bar")];
    const trees: Vec2[] = [[60, 60], [-60, -60], [80, -20]];
    const model = composeArea(input({ candidates: [tower, estimated], pois, mappedTrees: trees }));
    const again = composeArea(input({ candidates: [estimated, tower], pois: pois.slice().reverse(), mappedTrees: trees.slice().reverse() }));
    expect(again).toEqual(model);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});
