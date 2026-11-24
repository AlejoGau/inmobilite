import { describe, expect, it } from "vitest";
import { estimateLevels, LEVEL_RANGES, resolveHeight, resolveProfile, resolveUse, type HeightProfile } from "./buildingHeight";

describe("resolveUse", () => {
  it("maps OSM tags to a use", () => {
    expect(resolveUse({ building: "apartments" })).toBe("residential");
    expect(resolveUse({ building: "retail" })).toBe("commercial");
    expect(resolveUse({ building: "yes", shop: "clothes" })).toBe("commercial");
    expect(resolveUse({ building: "school" })).toBe("civic");
    expect(resolveUse({ building: "yes", amenity: "cinema" })).toBe("civic");
    expect(resolveUse({ building: "yes" })).toBe("other");
  });
});

describe("resolveHeight", () => {
  it("uses the height tag first", () => {
    expect(resolveHeight({ height: "21.5 m" }, "other", 200, 1)).toEqual({ height: 21.5, levels: 7, heightSource: "osm" });
  });

  it("uses levels x 3 m, with a taller ground floor for shops", () => {
    expect(resolveHeight({ "building:levels": "4" }, "residential", 200, 1)).toEqual({
      height: 12,
      levels: 4,
      heightSource: "osm",
    });
    expect(resolveHeight({ "building:levels": "2" }, "commercial", 200, 1).height).toBe(7.2);
  });

  it("estimates deterministically when OSM has nothing", () => {
    const a = resolveHeight({ building: "yes" }, "other", 200, 123);
    expect(a.heightSource).toBe("estimated");
    expect(resolveHeight({ building: "yes" }, "other", 200, 123)).toEqual(a);
  });
});

describe("estimateLevels", () => {
  const cases: [HeightProfile, number][] = [
    ["apartments", 500],
    ["house", 150],
    ["commercial", 200],
    ["largeCommercial", 900],
    ["civic", 800],
    ["minor", 30],
    ["generic", 200],
    ["generic", 40],
  ];

  it.each(cases)("keeps %s (area %d m²) within its range", (profile, area) => {
    const [min, max] = LEVEL_RANGES[profile];
    const seen = new Set<number>();
    for (let seed = 0; seed < 500; seed++) {
      const levels = estimateLevels(profile, area, seed * 7919);
      expect(levels).toBeGreaterThanOrEqual(min);
      expect(levels).toBeLessThanOrEqual(max);
      seen.add(levels);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("switches shops to the larger range above 600 m²", () => {
    expect(resolveProfile({ building: "retail" }, "commercial", 500)).toBe("commercial");
    expect(resolveProfile({ building: "retail" }, "commercial", 700)).toBe("largeCommercial");
  });
});
