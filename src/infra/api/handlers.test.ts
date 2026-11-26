import { describe, expect, it, vi } from "vitest";
import type { GeocodeResponse } from "@/domain/types";
import { LruCache } from "../cache/lruCache";
import type { GeocodeOutcome } from "../geocoding";
import { createGeocodeHandler } from "./geocodeHandler";

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
