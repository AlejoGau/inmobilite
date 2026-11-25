import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOverpassQuery, OVERPASS_QUERY_TIMEOUT_S } from "@/domain/osm/overpass";
import {
  fetchOverpass,
  normalizeOverpassResponse,
  OVERPASS_BUDGET_MS,
  OVERPASS_MIRRORS,
  OVERPASS_STAGGER_MS,
} from "./overpassClient";

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

  it("keeps multipolygon relations with their member geometry, dropping unresolved geometry", () => {
    const outer = [
      { lat: -34.5941, lon: -58.3768 },
      { lat: -34.5952, lon: -58.375 },
    ];
    const plaza = {
      type: "relation",
      id: 531073,
      tags: { leisure: "park", name: "Plaza San Martín", type: "multipolygon" },
      members: [
        { type: "way", ref: 17492581, role: "outer", geometry: outer },
        { type: "way", ref: 19754387, role: "outer", geometry: [outer[1], null] },
        { type: "node", ref: 5, role: "label", lat: -34.5946, lon: -58.3759 },
      ],
    };
    expect(normalizeOverpassResponse({ elements: [plaza] }).elements).toEqual([
      {
        ...plaza,
        members: [
          { type: "way", ref: 17492581, role: "outer", geometry: outer },
          { type: "way", ref: 19754387, role: "outer" },
          { type: "node", ref: 5, role: "label" },
        ],
      },
    ]);
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

  it("declares a server-side timeout below the client's budget, so no mirror works for nobody", () => {
    expect(OVERPASS_QUERY_TIMEOUT_S * 1000).toBeLessThan(OVERPASS_BUDGET_MS);
    expect(buildOverpassQuery({ lat: -34.6183, lng: -58.43646 })).toContain(`[timeout:${OVERPASS_QUERY_TIMEOUT_S}]`);
  });
});

/** Mirrors that accept the request and never answer, as overpass.private.coffee did on 2026-11-24. */
function hang(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    const signal = init.signal;
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Stubs fetch with a per-mirror answer and records each call's mirror and signal. */
function stubMirrors(answer: (mirror: string, init: RequestInit) => Promise<Response>) {
  const calls: { mirror: string; signal: AbortSignal }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (mirror: string, init: RequestInit) => {
      calls.push({ mirror, signal: init.signal as AbortSignal });
      return answer(mirror, init);
    }),
  );
  return calls;
}

describe("fetchOverpass with dead mirrors", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not let a hung mirror hold up the next one, and aborts it once another answers", async () => {
    const calls = stubMirrors(async (mirror, init) =>
      mirror === OVERPASS_MIRRORS[0] ? hang(init) : Response.json({ elements: [WAY] }),
    );
    const pending = fetchOverpass("q");

    await vi.advanceTimersByTimeAsync(OVERPASS_STAGGER_MS);
    expect(calls.map((c) => c.mirror)).toEqual(OVERPASS_MIRRORS.slice(0, 2));
    expect((await pending).elements).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("gives up after one overall budget when no mirror answers, instead of a timeout per mirror", async () => {
    const calls = stubMirrors(async (_, init) => hang(init));
    const outcome = expect(fetchOverpass("q")).rejects.toThrow(`No Overpass mirror answered within ${OVERPASS_BUDGET_MS} ms`);

    await vi.advanceTimersByTimeAsync(OVERPASS_BUDGET_MS);
    await outcome;
    expect(calls.map((c) => c.mirror)).toEqual([...OVERPASS_MIRRORS]);
    expect(calls.every((c) => c.signal.aborted)).toBe(true);
  });

  it("propagates the caller's abort at once, without trying more mirrors", async () => {
    const calls = stubMirrors(async (_, init) => hang(init));
    const controller = new AbortController();
    const pending = fetchOverpass("q", controller.signal);
    controller.abort();

    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    await vi.advanceTimersByTimeAsync(OVERPASS_BUDGET_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(true);
  });
});
