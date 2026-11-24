import { z } from "zod";
import type { OverpassElement, OverpassResponse } from "@/domain/osm/overpass";
import { fetchJson, UpstreamError } from "../http/fetchJson";

/** Public mirrors, tried in order. They go down often; one usually answers. */
export const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
] as const;

export const OVERPASS_TIMEOUT_MS = 20_000;

const latLon = z.object({ lat: z.number(), lon: z.number() });
const tags = z.record(z.string(), z.string()).optional();

const nodeSchema = z.object({ type: z.literal("node"), id: z.number(), lat: z.number(), lon: z.number(), tags });
const waySchema = z.object({
  type: z.literal("way"),
  id: z.number(),
  nodes: z.array(z.number()),
  // `out geom` can emit null for nodes it could not resolve; such ways are dropped below.
  geometry: z.array(latLon.nullable()),
  bounds: z.object({ minlat: z.number(), minlon: z.number(), maxlat: z.number(), maxlon: z.number() }).optional(),
  tags,
});

/** Loose on purpose: unknown element types and extra keys are ignored, not fatal. */
const responseSchema = z.object({
  version: z.number().optional(),
  generator: z.string().optional(),
  remark: z.string().optional(),
  elements: z.array(z.unknown()),
});

type RawResponse = z.infer<typeof responseSchema>;

export function normalizeOverpassResponse(raw: RawResponse): OverpassResponse {
  // Overpass answers 200 with a remark when the query times out or runs out of memory; the data is partial.
  if (raw.remark && /runtime error|timed out|out of memory/i.test(raw.remark)) {
    throw new UpstreamError(`Overpass runtime error: ${raw.remark}`);
  }
  const elements: OverpassElement[] = [];
  for (const item of raw.elements) {
    const node = nodeSchema.safeParse(item);
    if (node.success) {
      elements.push(node.data);
      continue;
    }
    const way = waySchema.safeParse(item);
    if (way.success && way.data.geometry.every((p) => p !== null) && way.data.geometry.length === way.data.nodes.length) {
      elements.push({ ...way.data, geometry: way.data.geometry.filter((p) => p !== null) });
    }
  }
  return { version: raw.version, generator: raw.generator, elements };
}

/** POSTs the query to each mirror in turn until one returns valid data. */
export async function fetchOverpass(query: string, signal?: AbortSignal): Promise<OverpassResponse> {
  const failures: string[] = [];
  for (const mirror of OVERPASS_MIRRORS) {
    signal?.throwIfAborted();
    try {
      const raw = await fetchJson(mirror, responseSchema, {
        timeoutMs: OVERPASS_TIMEOUT_MS,
        signal,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: new URLSearchParams({ data: query }).toString(),
        },
      });
      return normalizeOverpassResponse(raw);
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new UpstreamError(`All Overpass mirrors failed: ${failures.join(" | ")}`);
}
