import { describe, expect, it } from "vitest";
import { latToTileY, lngToTileX, tilesCoveringRadius, tileUrl } from "./tiles";

const ACOYTE_Y_RIVADAVIA = { lng: -58.43646, lat: -34.6183 };

describe("tile maths", () => {
  it("puts the demo corner in the tiles the GCBA and OpenFreeMap answer for", () => {
    // Verified live: z17 44259/78985 holds GCBA "tejido" pieces at the corner; z14 5532/9873 is the OpenFreeMap tile.
    expect(Math.floor(lngToTileX(ACOYTE_Y_RIVADAVIA.lng, 17))).toBe(44259);
    expect(Math.floor(latToTileY(ACOYTE_Y_RIVADAVIA.lat, 17))).toBe(78985);
    expect(Math.floor(lngToTileX(ACOYTE_Y_RIVADAVIA.lng, 14))).toBe(5532);
    expect(Math.floor(latToTileY(ACOYTE_Y_RIVADAVIA.lat, 14))).toBe(9873);
  });

  it("covers a radius with every tile it touches, in a stable order", () => {
    const tiles = tilesCoveringRadius(ACOYTE_Y_RIVADAVIA, 160, 17);
    // A z17 tile is about 250 m wide here, so a 320 m square spans 2-3 tiles per axis.
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.length).toBeLessThanOrEqual(9);
    expect(tiles).toContainEqual({ z: 17, x: 44259, y: 78985 });
    const sorted = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
    expect(tiles).toEqual(sorted);
  });

  it("covers a tiny radius with the single tile under the point", () => {
    expect(tilesCoveringRadius(ACOYTE_Y_RIVADAVIA, 1, 14)).toEqual([{ z: 14, x: 5532, y: 9873 }]);
  });

  it("fills URL templates", () => {
    expect(tileUrl("https://h/t/{z}/{x}/{y}.pbf", { z: 17, x: 1, y: 2 })).toBe("https://h/t/17/1/2.pbf");
  });
});
