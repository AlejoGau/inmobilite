import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOverpass, normalizeOverpassResponse, OVERPASS_MIRRORS } from "./overpassClient";

const WAY = {
  type: "way",
  id: 1,
  nodes: [10, 11],
  geometry: [
    { lat: -34.6, lon: -58.4 },
    { lat: -34.61, lon: -58.41 },
  ],
  tags: { highway: "residential" },
};

describe("normalizeOverpassResponse", () => {
  it("keeps valid nodes and ways and drops anything odd", () => {
    const result = normalizeOverpassResponse({
      elements: [
        WAY,
        { type: "node", id: 2, lat: -34.6, lon: -58.4, tags: { natural: "tree" } },
        { type: "relation", id: 3, members: [] },
        { ...WAY, id: 4, geometry: [null, { lat: 1, lon: 1 }] },
        { type: "node", id: 5 },
      ],
    });
    expect(result.elements.map((e) => `${e.type}/${e.id}`)).toEqual(["way/1", "node/2"]);
  });

  it("treats a runtime-error remark as a failure", () => {
    expect(() => normalizeOverpassResponse({ remark: "runtime error: Query timed out", elements: [] })).toThrow();
  });
});

describe("fetchOverpass", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to each mirror in order until one answers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (calls.length === 1) return new Response("busy", { status: 504 });
        return Response.json({ version: 0.6, elements: [WAY] });
      }),
    );

    const result = await fetchOverpass("[out:json];way(1);out geom;");
    expect(result.elements).toHaveLength(1);
    expect(calls.map((c) => c.url)).toEqual(OVERPASS_MIRRORS.slice(0, 2));
    expect(calls[0].init.method).toBe("POST");
    expect(String(calls[0].init.body)).toBe("data=%5Bout%3Ajson%5D%3Bway%281%29%3Bout+geom%3B");
    expect((calls[0].init.headers as Record<string, string>)["User-Agent"]).toBe("inmobilite-demo/0.1");
  });

  it("throws when every mirror fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(fetchOverpass("q")).rejects.toThrow(/All Overpass mirrors failed/);
  });
});
