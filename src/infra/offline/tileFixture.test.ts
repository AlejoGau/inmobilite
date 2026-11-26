import { beforeAll, describe, expect, it } from "vitest";
import { areaFromTiles, GCBA_ATTRIBUTION, type TileSources } from "@/domain/area/areaFromTiles";
import { pointInRing } from "@/domain/geo/polygon";
import { MAX_BUILDINGS, type AreaModel } from "@/domain/types";
import { AREA_RADII } from "../api/areaHandler";
import { FIXTURE_ORIGIN, isCoveredByFixture, loadTileFixture } from "./tileFixture";

/** End to end on the real tiles saved around Av. Acoyte y Av. Rivadavia: decoders, tile context, GCBA, compose. */
describe("the tile pipeline on the saved Acoyte y Rivadavia tiles", () => {
  let sources: TileSources;
  let model: AreaModel;
  beforeAll(async () => {
    const loaded = await loadTileFixture(FIXTURE_ORIGIN, AREA_RADII);
    if (!loaded) throw new Error("the fixture must cover its own origin");
    sources = loaded;
    model = areaFromTiles(FIXTURE_ORIGIN, sources);
  });

  it("models the 20 closest GCBA parcels with their measured multi-part volumes", () => {
    expect(model.buildings).toHaveLength(MAX_BUILDINGS);
    expect(model.buildings.every((b) => b.heightSource === "gcba" && b.smp)).toBe(true);
    expect(model.stats).toMatchObject({ buildings: MAX_BUILDINGS, estimatedHeights: 0 });
    const bySmp = new Map(model.buildings.map((b) => [b.smp, b]));
    expect(bySmp.get("040-088-010")?.height).toBeCloseTo(42, 1); // Rivadavia 4990
    expect(bySmp.get("045-068-019")?.height).toBeCloseTo(44.8, 1); // Rivadavia 5013
    expect(model.buildings.some((b) => b.parts.length > 1)).toBe(true);
  });

  it("draws the corner's named streets, parks and trees", () => {
    const names = new Set(model.roads.map((r) => r.name));
    for (const name of ["Avenida Rivadavia", "Avenida Acoyte", "Avenida José María Moreno"]) expect(names).toContain(name);
    expect(model.stats.streets.slice(0, 3).sort()).toEqual(["Avenida Acoyte", "Avenida José María Moreno", "Avenida Rivadavia"]);
    expect(model.labels.length).toBeGreaterThan(0);
    expect(model.parks.map((p) => p.name)).toContain("Parque Rivadavia");
    expect(model.trees.length).toBeGreaterThan(50);
  });

  it("keeps every tree out of every building part", () => {
    const parts = model.buildings.flatMap((b) => b.parts);
    for (const tree of model.trees) expect(parts.some((part) => pointInRing(tree.position, part.footprint))).toBe(false);
  });

  it("credits OSM, OpenFreeMap and the GCBA", () => {
    expect(model.attribution).toBe(`© OpenStreetMap contributors · OpenFreeMap · ${GCBA_ATTRIBUTION}`);
  });

  it("names and classes buildings from the shops inside them", () => {
    const named = model.buildings.filter((b) => b.name);
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((b) => b.use === "commercial")).toBe(true);
  });

  it("is deterministic and plain JSON", () => {
    expect(areaFromTiles(FIXTURE_ORIGIN, { ...sources, features: [...sources.features].reverse() })).toEqual(model);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it("without the GCBA, falls back to the tiles' own footprints and drops the GCBA credit", () => {
    const tilesOnly = areaFromTiles(FIXTURE_ORIGIN, { features: sources.features, tejido: null });
    expect(tilesOnly.buildings).toHaveLength(MAX_BUILDINGS);
    expect(tilesOnly.buildings.every((b) => b.heightSource !== "gcba")).toBe(true);
    expect(tilesOnly.attribution).toBe("© OpenStreetMap contributors · OpenFreeMap");
  });
});

describe("fixture coverage", () => {
  it("serves only origins whose every live tile is saved", () => {
    expect(isCoveredByFixture(FIXTURE_ORIGIN, AREA_RADII)).toBe(true);
    expect(isCoveredByFixture({ lat: -34.616703, lng: -58.432864 }, AREA_RADII)).toBe(false); // Rivadavia y Campichuelo, ~375 m
    expect(isCoveredByFixture({ lat: -34.56, lng: -58.455 }, AREA_RADII)).toBe(false); // Belgrano
  });

  it("returns null for an origin it does not cover", async () => {
    expect(await loadTileFixture({ lat: -34.56, lng: -58.455 }, AREA_RADII)).toBeNull();
  });
});
