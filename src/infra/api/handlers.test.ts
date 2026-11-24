import { describe, expect, it, vi } from "vitest";
import fixture from "@/domain/__fixtures__/acoyte-rivadavia.overpass.json";
import type { OverpassResponse } from "@/domain/osm/overpass";
import type { AreaModel, GeocodeResponse } from "@/domain/types";
import { LruCache } from "../cache/lruCache";
import type { GeocodeOutcome } from "../geocoding";
import { loadOfflineFallback } from "../osm/offlineFallback";
import { createAreaHandler, parseAreaParams } from "./areaHandler";
import { createGeocodeHandler } from "./geocodeHandler";

const FIXTURE = fixture as unknown as OverpassResponse;

describe("geocode handler", () => {
  const outcome = (o: Partial<GeocodeOutcome>): GeocodeOutcome => ({ results: [], degraded: false, allFailed: false, ...o });
  const hit = { id: "usig:x", label: "Av. Acoyte y Av. Rivadavia", lat: -34.6, lng: -58.4, kind: "intersection", provider: "usig" } as const;

  it("rejects queries shorter than 3 characters", async () => {
    const handler = createGeocodeHandler({ geocode: vi.fn(), cache: new LruCache(10) });
    expect((await handler("  ab ")).status).toBe(400);
    expect((await handler(null)).status).toBe(400);
  });

  it("answers and caches by normalised query", async () => {
    const geocode = vi.fn(async () => outcome({ results: [hit] }));
    const handler = createGeocodeHandler({ geocode, cache: new LruCache<GeocodeResponse>(10) });
    const first = await handler("Acoyte  y riva");
    const second = await handler("acoyte y riva ");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ query: "Acoyte y riva", results: [hit] });
    expect(second.body).toEqual({ query: "acoyte y riva", results: [hit] });
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(first.headers["Cache-Control"]).toContain("max-age");
  });

  it("does not cache degraded answers, and fails with 502 when every provider is down", async () => {
    const geocode = vi
      .fn<(q: string) => Promise<GeocodeOutcome>>()
      .mockResolvedValueOnce(outcome({ degraded: true }))
      .mockResolvedValueOnce(outcome({ degraded: true, allFailed: true }));
    const handler = createGeocodeHandler({ geocode, cache: new LruCache<GeocodeResponse>(10) });
    const degraded = await handler("zzz qqq");
    expect(degraded.status).toBe(200);
    expect(degraded.headers["Cache-Control"]).toBe("no-store");
    const down = await handler("zzz qqq");
    expect(down.status).toBe(502);
    expect(down.body).toHaveProperty("error");
  });
});

describe("area handler", () => {
  const ACOYTE = { lat: "-34.618300", lng: "-58.436460" };
  const failingOverpass = async (): Promise<OverpassResponse> => {
    throw new Error("all mirrors down");
  };

  it("validates coordinates", () => {
    expect(parseAreaParams("-34.6183", "-58.43646")).toEqual({ lat: -34.6183, lng: -58.43646 });
    expect(parseAreaParams("-34.6183000001", "-58.436460004")).toEqual({ lat: -34.6183, lng: -58.43646 });
    expect(parseAreaParams("", "-58.4")).toBeNull();
    expect(parseAreaParams("abc", "-58.4")).toBeNull();
    expect(parseAreaParams("95", "-58.4")).toBeNull();
    expect(parseAreaParams("-34.6", "-181")).toBeNull();
    expect(parseAreaParams(null, null)).toBeNull();
  });

  it("returns 400 for invalid coordinates", async () => {
    const handler = createAreaHandler({ fetchOverpass: vi.fn(), loadFallback: vi.fn(), cache: new LruCache(10) });
    expect((await handler("x", "y")).status).toBe(400);
  });

  it("builds the model from Overpass and caches it, sharing concurrent requests", async () => {
    const fetchOverpass = vi.fn(async () => FIXTURE);
    const handler = createAreaHandler({ fetchOverpass, loadFallback: vi.fn(), cache: new LruCache(10) });
    const [a, b] = await Promise.all([handler(ACOYTE.lat, ACOYTE.lng), handler(ACOYTE.lat, ACOYTE.lng)]);
    const c = await handler("-34.6183", "-58.43646");
    expect(fetchOverpass).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    expect(a.headers["X-Area-Source"]).toBe("osm");
    expect(b.body).toBe(a.body);
    expect(c.body).toBe(a.body);
    expect((a.body as AreaModel).buildings.length).toBe(20);
  });

  it("falls back to the bundled fixture near the demo corner when Overpass is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = createAreaHandler({
      fetchOverpass: failingOverpass,
      loadFallback: loadOfflineFallback,
      cache: new LruCache(10),
    });
    const near = await handler("-34.6200", "-58.4380"); // ~230 m away
    expect(near.status).toBe(200);
    expect(near.headers["X-Area-Source"]).toBe("fixture");
    expect((near.body as AreaModel).stats.streets.length).toBeGreaterThan(3);

    const far = await handler("-34.5600", "-58.4550"); // Belgrano
    expect(far.status).toBe(503);
    expect(far.body).toHaveProperty("error");
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry and honours TTL", () => {
    let now = 0;
    const cache = new LruCache<number>(2, () => now);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    cache.set("t", 9, 100);
    now = 101;
    expect(cache.get("t")).toBeUndefined();
  });
});
