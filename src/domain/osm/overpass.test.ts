import { describe, expect, it } from "vitest";
import { buildOverpassQuery } from "./overpass";

describe("buildOverpassQuery", () => {
  // Plaza San Martín (relation 531073): a leisure=park multipolygon whose outer ways carry no tags.
  const query = buildOverpassQuery({ lat: -34.59464, lng: -58.375905 });
  const around = (radius: number) => `(around:${radius},-34.594640,-58.375905);`;

  it("asks for buildings and parks mapped as multipolygon relations too", () => {
    expect(query).toContain(`relation["building"]["type"="multipolygon"]${around(160)}`);
    expect(query).toContain(`relation["leisure"~"^(park|garden|playground)$"]["type"="multipolygon"]${around(300)}`);
    expect(query).toContain(`relation["landuse"~"^(grass|recreation_ground)$"]["type"="multipolygon"]${around(300)}`);
  });

  it("keeps the closed ways, and `out geom` so relations come with their member geometry", () => {
    expect(query).toContain(`way["building"]${around(160)}`);
    expect(query).toContain(`way["highway"]${around(300)}`);
    expect(query).toContain(`node["natural"="tree"]${around(300)}`);
    expect(query.endsWith(");out geom;")).toBe(true);
  });
});
