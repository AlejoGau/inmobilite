import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeVectorTile } from "./vectorTile";

const FIXTURES = path.join(__dirname, "__fixtures__");
const ACOYTE_Y_RIVADAVIA = { lng: -58.43646, lat: -34.6183 };

/** Real tiles saved on 2026-11-25 (see the file names for z/x/y). */
const gcbaTile = new Uint8Array(readFileSync(path.join(FIXTURES, "gcba-tejido-17-44259-78985.pbf.gz")));
const ofmTile = new Uint8Array(readFileSync(path.join(FIXTURES, "ofm-14-5532-9873.pbf")));

function firstCoordinate(geometry: GeoJSON.Geometry): number[] {
  switch (geometry.type) {
    case "Point":
      return geometry.coordinates;
    case "LineString":
    case "MultiPoint":
      return geometry.coordinates[0];
    case "Polygon":
    case "MultiLineString":
      return geometry.coordinates[0][0];
    case "MultiPolygon":
      return geometry.coordinates[0][0][0];
    default:
      throw new Error(`unexpected geometry ${geometry.type}`);
  }
}

describe("decodeVectorTile", () => {
  it("reads the GCBA 3D city model tile even when the body is still gzipped", () => {
    const features = decodeVectorTile(gcbaTile, { z: 17, x: 44259, y: 78985 }, ["default"]);
    expect(features.length).toBeGreaterThan(500);
    const piece = features.find((f) => typeof f.properties.smp === "string" && Number(f.properties.altura) > 0);
    expect(piece).toBeDefined();
    expect(piece?.geometry.type).toMatch(/Polygon/);
    expect(piece?.properties).toHaveProperty("altura");
  });

  it("converts tile coordinates to lng/lat inside the tile around the corner", () => {
    const features = decodeVectorTile(gcbaTile, { z: 17, x: 44259, y: 78985 }, ["default"]);
    for (const f of features.slice(0, 50)) {
      const [lng, lat] = firstCoordinate(f.geometry);
      // A z17 tile is ~0.0027° wide; allow the tile buffer around it.
      expect(Math.abs(lng - ACOYTE_Y_RIVADAVIA.lng)).toBeLessThan(0.01);
      expect(Math.abs(lat - ACOYTE_Y_RIVADAVIA.lat)).toBeLessThan(0.01);
    }
  });

  it("reads only the requested OpenFreeMap layers", () => {
    // Urban parks live in OpenMapTiles' "landcover" (class grass, subclass park), not in "park" (national parks).
    const features = decodeVectorTile(ofmTile, { z: 14, x: 5532, y: 9873 }, ["transportation", "landcover", "missing-layer"]);
    const layers = new Set(features.map((f) => f.layer));
    expect(layers).toEqual(new Set(["transportation", "landcover"]));
    expect(features.some((f) => f.layer === "transportation" && f.properties.class === "primary")).toBe(true);
    expect(features.some((f) => f.layer === "landcover" && f.properties.subclass === "park")).toBe(true);
  });

  it("is deterministic", () => {
    const tile = { z: 14, x: 5532, y: 9873 };
    expect(decodeVectorTile(ofmTile, tile, ["transportation_name"])).toEqual(decodeVectorTile(ofmTile, tile, ["transportation_name"]));
  });
});
