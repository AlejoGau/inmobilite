import { describe, expect, it } from "vitest";
import type { AreaModel, Building, Road, Ring } from "../types";
import { FACADE_CREDIT, frontEdge, frontNormal, normalizeSmp, pickFeatured, propertyFront, withFacades } from "./facade";

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function building(id: string, footprint: Ring, distance: number, smp?: string): Building {
  return {
    id,
    footprint,
    parts: [{ footprint, height: 12 }],
    height: 12,
    levels: 4,
    heightSource: smp ? "gcba" : "estimated",
    use: "residential",
    area: 100,
    distance,
    seed: 1,
    ...(smp ? { smp } : {}),
  };
}

// An east-west avenue along y = 0 (20 m wide) and a footway along x = -40.
const avenue: Road = { id: "r1", cls: "primary", width: 20, points: [[-100, 0], [100, 0]] };
const footway: Road = { id: "r2", cls: "footway", width: 3, points: [[-40, -50], [-40, 50]] };

describe("normalizeSmp", () => {
  it("zero-pads every number and upper-cases the letters", () => {
    expect(normalizeSmp("45-068-020C")).toBe("045-068-020C");
    expect(normalizeSmp(" 045-68-20c ")).toBe("045-068-020C");
    expect(normalizeSmp("040-088-009")).toBe("040-088-009");
  });
  it("rejects anything that is not an SMP", () => {
    expect(normalizeSmp("")).toBeNull();
    expect(normalizeSmp("45-068")).toBeNull();
    expect(normalizeSmp("45-0x8-020")).toBeNull();
  });
});

describe("pickFeatured", () => {
  const buildings = [
    building("a", rect(0, 12, 10, 30), 5, "045-068-001"),
    building("b", rect(12, 12, 22, 30), 15, "045-068-002"),
    building("c", rect(-11, 12, -1, 30), 8, "045-068-003"),
    building("d", rect(60, 12, 70, 30), 40, "045-068-004"),
    building("e", rect(24, 12, 34, 30), 30, "045-068-020C"),
  ];

  it("takes the building with the searched parcel, then its two nearest neighbours", () => {
    expect(pickFeatured({ buildings }, "45-068-20c")).toEqual(["e", "b", "a"]);
  });

  it("falls back to the building nearest the origin when the parcel is unknown or not modelled", () => {
    expect(pickFeatured({ buildings }, null)).toEqual(["a", "c", "b"]);
    expect(pickFeatured({ buildings }, "099-001-001")).toEqual(["a", "c", "b"]);
  });

  it("returns what there is for tiny areas", () => {
    expect(pickFeatured({ buildings: [] }, null)).toEqual([]);
    expect(pickFeatured({ buildings: buildings.slice(0, 2) }, null)).toEqual(["a", "b"]);
  });
});

describe("frontEdge", () => {
  it("picks the wall facing the avenue, with the street on its right", () => {
    const front = frontEdge(building("a", rect(0, 12, 10, 30), 5), [avenue]);
    expect(front).not.toBeNull();
    const [a, b] = front!;
    // The south wall (y = 12) walked west -> east would have the street on its right.
    expect(a[1]).toBe(12);
    expect(b[1]).toBe(12);
    expect(frontNormal(front!)).toEqual([0, -1]);
  });

  it("orients the edge toward the road whatever the ring winding", () => {
    const clockwise = [...rect(0, 12, 10, 30)].reverse();
    const n = frontNormal(frontEdge(building("a", clockwise, 5), [avenue])!);
    expect(n[0]).toBeCloseTo(0, 9);
    expect(n[1]).toBeCloseTo(-1, 9);
  });

  it("ignores footways and short chamfer edges", () => {
    // A chamfered corner: the 2 m chamfer is the closest edge to the avenue's kerb, but too short to be the front.
    const ring: Ring = [
      [-38, 13],
      [-36, 11],
      [-20, 11],
      [-20, 30],
      [-38, 30],
    ];
    const [a, b] = frontEdge(building("x", ring, 5), [avenue, footway])!;
    expect(a[1]).toBe(11);
    expect(b[1]).toBe(11);
  });

  it("is null without a vehicular road", () => {
    expect(frontEdge(building("a", rect(0, 12, 10, 30), 5), [footway])).toBeNull();
  });
});

describe("withFacades", () => {
  const area = {
    buildings: [building("a", rect(0, 12, 10, 30), 5, "045-068-001"), building("b", rect(12, 12, 22, 30), 15)],
    roads: [avenue],
    attribution: "© OpenStreetMap",
  } as unknown as AreaModel;

  it("attaches the photo and the front wall to featured buildings with a parcel, and credits it", () => {
    const photos = new Map([["045-068-001", { url: "https://x/foto", date: "2006-07-07" }]]);
    const out = withFacades(area, ["a", "b"], photos);
    expect(out.featuredBuildingIds).toEqual(["a", "b"]);
    expect(out.buildings[0].facade).toEqual({ url: "https://x/foto", date: "2006-07-07", credit: FACADE_CREDIT, front: [[0, 12], [10, 12]] });
    expect(out.buildings[1].facade).toBeUndefined();
    expect(out.attribution).toBe(`© OpenStreetMap · ${FACADE_CREDIT}`);
    expect(area.buildings[0].facade).toBeUndefined();
  });

  it("marks the featured buildings even without photos, and leaves the credit out", () => {
    const out = withFacades(area, ["a"], new Map());
    expect(out.featuredBuildingIds).toEqual(["a"]);
    expect(out.buildings.every((b) => !b.facade)).toBe(true);
    expect(out.attribution).toBe("© OpenStreetMap");
  });
});

describe("propertyFront", () => {
  it("is the searched property's photo wall, or its street wall without a photo, or null", () => {
    const a = building("a", rect(0, 12, 10, 30), 5);
    const area = { buildings: [a], roads: [avenue], featuredBuildingIds: ["a"] };
    expect(propertyFront(area)).toMatchObject({ building: a, mid: [5, 12], normal: [0, -1] });
    const withPhoto = { ...a, facade: { url: "u", credit: FACADE_CREDIT, front: [[10, 30], [0, 30]] as [[number, number], [number, number]] } };
    expect(propertyFront({ ...area, buildings: [withPhoto] })?.mid).toEqual([5, 30]);
    expect(propertyFront({ buildings: [a], roads: [avenue] })).toBeNull();
  });
});
