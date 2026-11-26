import { describe, expect, it } from "vitest";
import { heightSourceLabel, levelsLabel } from "./SelectionTag";

describe("selection tag labels", () => {
  it("says whether the height was measured by the city or estimated", () => {
    expect(heightSourceLabel("gcba")).toBe("altura medida (GCBA)");
    expect(heightSourceLabel("estimated")).toBe("altura estimada");
    expect(heightSourceLabel("osm")).toBeNull();
  });

  it("counts storeys in Spanish", () => {
    expect(levelsLabel(1)).toBe("1 piso");
    expect(levelsLabel(27)).toBe("27 pisos");
  });
});
