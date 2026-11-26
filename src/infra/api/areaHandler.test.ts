import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GCBA_ATTRIBUTION, type TileSources } from "@/domain/area/areaFromTiles";
import { FACADE_CREDIT, normalizeSmp } from "@/domain/area/facade";
import { createProjection } from "@/domain/geo/projection";
import { centroid } from "@/domain/geo/polygon";
import type { OverpassResponse } from "@/domain/osm/overpass";
import type { AreaModel } from "@/domain/types";
import { LruCache } from "../cache/lruCache";
import { FIXTURE_ORIGIN, loadTileFixture } from "../offline/tileFixture";
import { AREA_RADII, createAreaHandler, parseAreaParams, type AreaHandlerDeps } from "./areaHandler";

const ACOYTE = { lat: String(FIXTURE_ORIGIN.lat), lng: String(FIXTURE_ORIGIN.lng) };
const BELGRANO = { lat: "-34.56", lng: "-58.455" };

let saved: TileSources;
beforeAll(async () => {
  const loaded = await loadTileFixture(FIXTURE_ORIGIN, AREA_RADII);
  if (!loaded) throw new Error("fixture missing");
  saved = loaded;
});

afterEach(() => vi.restoreAllMocks());

const fail = async (): Promise<never> => {
  throw new Error("down");
};
const emptyOverpass = async (): Promise<OverpassResponse> => ({ elements: [] });

function deps(overrides: Partial<AreaHandlerDeps> = {}): AreaHandlerDeps {
  return {
    fetchTileFeatures: vi.fn(async () => [...saved.features]),
    fetchTejido: vi.fn(async () => (saved.tejido ? [...saved.tejido] : null)),
    fetchOverpass: vi.fn(emptyOverpass),
    loadFixture: vi.fn(async () => null),
    cache: new LruCache(10),
    complementBudgetMs: 50,
    ...overrides,
  };
}

const model = (body: unknown) => body as AreaModel;

describe("area handler", () => {
  it("validates coordinates", () => {
    expect(parseAreaParams("-34.6183", "-58.43646")).toEqual({ lat: -34.6183, lng: -58.43646 });
    expect(parseAreaParams("-34.6183000001", "-58.436460004")).toEqual({ lat: -34.6183, lng: -58.43646 });
    expect(parseAreaParams("", "-58.4")).toBeNull();
    expect(parseAreaParams("abc", "-58.4")).toBeNull();
    expect(parseAreaParams("95", "-58.4")).toBeNull();
    expect(parseAreaParams("-34.6", "-181")).toBeNull();
    expect(parseAreaParams(null, null)).toBeNull();
  });

  it("returns 400 for invalid coordinates without fetching", async () => {
    const d = deps();
    const result = await createAreaHandler(d)("x", "y");
    expect(result.status).toBe(400);
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(d.fetchTileFeatures).not.toHaveBeenCalled();
  });

  it("builds from tiles + GCBA, asks each source once with the area radii, and caches", async () => {
    const d = deps();
    const handler = createAreaHandler(d);
    const [a, b] = await Promise.all([handler(ACOYTE.lat, ACOYTE.lng), handler(ACOYTE.lat, ACOYTE.lng)]);
    const c = await handler("-34.6183000001", "-58.43646");
    expect(a.status).toBe(200);
    expect(a.headers).toEqual({
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "X-Area-Source": "tiles+gcba",
    });
    expect(b.body).toBe(a.body);
    expect(c.body).toBe(a.body);
    expect(d.fetchTileFeatures).toHaveBeenCalledTimes(1);
    expect(d.fetchTileFeatures).toHaveBeenCalledWith(FIXTURE_ORIGIN, AREA_RADII.contextM);
    expect(d.fetchTejido).toHaveBeenCalledWith(FIXTURE_ORIGIN, AREA_RADII.buildingsM);
    expect(d.fetchOverpass).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.fetchOverpass).mock.calls[0][0]).toMatch(/natural"="tree".*building"\]\["name"/);
    expect(model(a.body).attribution).toContain(GCBA_ATTRIBUTION);
    expect(model(a.body).buildings.every((x) => x.heightSource === "gcba")).toBe(true);
  });

  it("falls back to the tiles' footprints when the GCBA fails, with a short cache and no GCBA credit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await createAreaHandler(deps({ fetchTejido: fail }))(ACOYTE.lat, ACOYTE.lng);
    expect(result.status).toBe(200);
    expect(result.headers).toEqual({ "Cache-Control": "public, max-age=60", "X-Area-Source": "tiles" });
    expect(model(result.body).buildings).toHaveLength(20);
    expect(model(result.body).buildings.some((x) => x.heightSource === "gcba")).toBe(false);
    expect(model(result.body).attribution).toBe("© OpenStreetMap contributors · OpenFreeMap");
  });

  it("treats a GCBA null (outside CABA) as a complete tiles answer", async () => {
    const result = await createAreaHandler(deps({ fetchTejido: async () => null }))(ACOYTE.lat, ACOYTE.lng);
    expect(result.headers["X-Area-Source"]).toBe("tiles");
    expect(result.headers["Cache-Control"]).toContain("max-age=3600");
  });

  it("ignores an Overpass complement that fails or hangs past its budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hanging = deps({ fetchOverpass: vi.fn(() => new Promise<never>(() => {})) });
    const [failed, hung] = await Promise.all([
      createAreaHandler(deps({ fetchOverpass: fail }))(ACOYTE.lat, ACOYTE.lng),
      createAreaHandler(hanging)(ACOYTE.lat, ACOYTE.lng),
    ]);
    for (const result of [failed, hung]) {
      expect(result.status).toBe(200);
      expect(result.headers).toEqual({ "Cache-Control": "public, max-age=60", "X-Area-Source": "tiles+gcba" });
    }
    expect(vi.mocked(hanging.fetchOverpass).mock.calls[0][1].aborted).toBe(true);
  });

  it("adds the complement's mapped trees and building names", async () => {
    const base = model((await createAreaHandler(deps())(ACOYTE.lat, ACOYTE.lng)).body);
    const target = base.buildings.find((b) => !b.name) ?? base.buildings[0];
    const projection = createProjection(FIXTURE_ORIGIN);
    const toNode = (id: number, p: [number, number], tags: Record<string, string>) => {
      const { lng, lat } = projection.toLngLat(p);
      return { type: "node" as const, id, lat, lon: lng, tags };
    };
    // A named way around the target's centroid, and a tree on the corner itself (inside no building).
    const c = centroid(target.parts[0].footprint);
    const ring: [number, number][] = [[c[0] - 0.5, c[1] - 0.5], [c[0] + 0.5, c[1] - 0.5], [c[0] + 0.5, c[1] + 0.5], [c[0] - 0.5, c[1] + 0.5]];
    const geometry = [...ring, ring[0]].map((p) => {
      const { lng, lat } = projection.toLngLat(p);
      return { lat, lon: lng };
    });
    const osm: OverpassResponse = {
      elements: [
        toNode(1, [3, 3], { natural: "tree" }),
        { type: "way", id: 7, nodes: [1, 2, 3, 4, 1], geometry, tags: { building: "yes", name: "Edificio de prueba" } },
      ],
    };
    const enriched = model((await createAreaHandler(deps({ fetchOverpass: async () => osm }))(ACOYTE.lat, ACOYTE.lng)).body);
    expect(enriched.buildings.find((b) => b.id === target.id)?.name).toBe("Edificio de prueba");
    expect(enriched.trees.map((t) => t.position)).toContainEqual([3, 3]);
  });

  it("serves the saved tiles when OpenFreeMap is down near the demo corner, else 503", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps({ fetchTileFeatures: fail, loadFixture: (origin) => loadTileFixture(origin, AREA_RADII) });
    const handler = createAreaHandler(d);
    const near = await handler(ACOYTE.lat, ACOYTE.lng);
    expect(near.status).toBe(200);
    expect(near.headers).toEqual({ "Cache-Control": "public, max-age=60", "X-Area-Source": "fixture" });
    expect(model(near.body).buildings).toHaveLength(20);
    expect(model(near.body).attribution).toContain(GCBA_ATTRIBUTION);

    const far = await handler(BELGRANO.lat, BELGRANO.lng);
    expect(far.status).toBe(503);
    expect(far.body).toEqual({ error: "No pudimos traer los datos del mapa de esta zona. Probá de nuevo en un rato." });
    expect(far.headers["Cache-Control"]).toBe("no-store");
  });

  describe("facade photos", () => {
    const photoUrl = (smp: string) => `https://fotos.test/getFoto?smp=${smp}&i=0&w=1024`;
    const photoDeps = (overrides: Partial<AreaHandlerDeps> = {}) =>
      deps({
        reverseGeocodeSmp: vi.fn(async () => null),
        fetchFacadePhoto: vi.fn(async (smp: string) => ({ url: photoUrl(smp), date: "2006-07-07" })),
        facadeBudgetMs: 50,
        ...overrides,
      });

    it("features the searched parcel and its 2 neighbours, each with its photo and front wall", async () => {
      const base = model((await createAreaHandler(deps())(ACOYTE.lat, ACOYTE.lng)).body);
      // A parcel that is not the closest one, in the reverse geocoder's unpadded spelling.
      const target = base.buildings[5];
      const unpadded = target.smp!.replace(/^0+/, "");
      const d = photoDeps({ reverseGeocodeSmp: vi.fn(async () => unpadded) });
      const result = await createAreaHandler(d)(ACOYTE.lat, ACOYTE.lng);
      const area = model(result.body);

      expect(d.reverseGeocodeSmp).toHaveBeenCalledWith(FIXTURE_ORIGIN, expect.any(AbortSignal));
      expect(area.featuredBuildingIds).toHaveLength(3);
      expect(area.featuredBuildingIds![0]).toBe(target.id);
      expect(d.fetchFacadePhoto).toHaveBeenCalledTimes(3);
      const withPhoto = area.buildings.filter((b) => b.facade);
      expect(withPhoto.map((b) => b.id).sort()).toEqual([...area.featuredBuildingIds!].sort());
      for (const b of withPhoto) {
        expect(b.facade!.url).toBe(photoUrl(normalizeSmp(b.smp!)!));
        expect(b.facade!.credit).toBe(FACADE_CREDIT);
        expect(b.facade!.front).toHaveLength(2);
      }
      expect(area.attribution).toContain(FACADE_CREDIT);
      expect(result.headers["Cache-Control"]).toContain("max-age=3600");
    });

    it("ignores a reverse geocoder or photo service that fails or hangs, with a short cache", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const d = photoDeps({
        reverseGeocodeSmp: vi.fn(() => new Promise<never>(() => {})),
        fetchFacadePhoto: vi.fn(async (smp: string) => {
          if (smp.endsWith("1")) throw new Error("down");
          return { url: photoUrl(smp) };
        }),
      });
      const result = await createAreaHandler(d)(ACOYTE.lat, ACOYTE.lng);
      const area = model(result.body);
      expect(result.status).toBe(200);
      // Without the parcel, the property is the building nearest the origin.
      const nearest = [...area.buildings].sort((a, b) => a.distance - b.distance)[0];
      expect(area.featuredBuildingIds![0]).toBe(nearest.id);
      expect(result.headers["Cache-Control"]).toBe("public, max-age=60");
    });

    it("does not ask the reverse geocoder outside CABA", async () => {
      const d = photoDeps({ fetchTejido: async () => null });
      await createAreaHandler(d)("-31.42", "-64.18");
      expect(d.reverseGeocodeSmp).not.toHaveBeenCalled();
    });

    it("marks the featured buildings on the offline fixture, without photos", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const d = photoDeps({ fetchTileFeatures: fail, loadFixture: (origin) => loadTileFixture(origin, AREA_RADII) });
      const area = model((await createAreaHandler(d)(ACOYTE.lat, ACOYTE.lng)).body);
      expect(area.featuredBuildingIds).toHaveLength(3);
      expect(area.buildings.some((b) => b.facade)).toBe(false);
      expect(d.fetchFacadePhoto).not.toHaveBeenCalled();
    });
  });
});
