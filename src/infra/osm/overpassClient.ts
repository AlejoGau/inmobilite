import { z } from "zod";
import type { OverpassElement, OverpassMember, OverpassRelation, OverpassResponse } from "@/domain/osm/overpass";
import { fetchJson, UpstreamError } from "../http/fetchJson";
import { hedgedRace, RaceTimeoutError } from "../http/hedgedRace";

/** Public mirrors, in order of preference. They go down often; one usually answers. */
export const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
] as const;

/**
 * The whole Overpass phase, every mirror included, gets this long. Past it the area handler serves the
 * offline fixture or a 503 instead of keeping the visitor at the 3D handoff for up to a minute.
 */
export const OVERPASS_BUDGET_MS = 10_000;
/** A healthy mirror answers this query in 1-2 s; one that has not by then gets the next mirror alongside. */
export const OVERPASS_STAGGER_MS = 2_500;

const latLon = z.object({ lat: z.number(), lon: z.number() });
const tags = z.record(z.string(), z.string()).optional();
const bounds = z.object({ minlat: z.number(), minlon: z.number(), maxlat: z.number(), maxlon: z.number() }).optional();
// `out geom` can emit null for nodes it could not resolve; such geometry is dropped below.
const geometry = z.array(latLon.nullable());

const nodeSchema = z.object({ type: z.literal("node"), id: z.number(), lat: z.number(), lon: z.number(), tags });
const waySchema = z.object({ type: z.literal("way"), id: z.number(), nodes: z.array(z.number()), geometry, bounds, tags });
const relationSchema = z.object({
  type: z.literal("relation"),
  id: z.number(),
  members: z.array(
    z.object({
      type: z.enum(["node", "way", "relation"]),
      ref: z.number(),
      role: z.string(),
      geometry: geometry.optional(),
    }),
  ),
  bounds,
  tags,
});

type RawRelation = z.infer<typeof relationSchema>;

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
    if (way.success) {
      if (way.data.geometry.every((p) => p !== null) && way.data.geometry.length === way.data.nodes.length) {
        elements.push({ ...way.data, geometry: way.data.geometry.filter((p) => p !== null) });
      }
      continue;
    }
    const relation = relationSchema.safeParse(item);
    if (relation.success) {
      const normalized = normalizeRelation(relation.data);
      if (normalized) elements.push(normalized);
    }
  }
  return { version: raw.version, generator: raw.generator, elements };
}

/**
 * Keeps a member's geometry only when every point resolved: a ring with a gap cannot be assembled, so
 * the domain must see it as missing. A relation with no usable way at all is dropped, like an empty way.
 */
function normalizeRelation(relation: RawRelation): OverpassRelation | null {
  const members = relation.members.map(({ geometry, ...member }): OverpassMember => {
    const points = geometry?.filter((p) => p !== null);
    return points && points.length === geometry?.length ? { ...member, geometry: points } : member;
  });
  return members.some((m) => m.type === "way" && m.geometry) ? { ...relation, members } : null;
}

/**
 * POSTs the query to the mirrors as a hedged race (see hedgedRace): the first valid answer wins and the
 * others are aborted. A mirror that errors hands over at once and one that hangs costs one stagger, and
 * the whole call is bounded by OVERPASS_BUDGET_MS. A caller abort propagates as-is.
 */
export async function fetchOverpass(query: string, signal?: AbortSignal): Promise<OverpassResponse> {
  const attempts = OVERPASS_MIRRORS.map((mirror) => async (attemptSignal: AbortSignal) => {
    const raw = await fetchJson(mirror, responseSchema, {
      // Only a backstop: the race's deadline, counted from the first attempt, ends every attempt by then.
      timeoutMs: OVERPASS_BUDGET_MS,
      signal: attemptSignal,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: new URLSearchParams({ data: query }).toString(),
      },
    });
    return normalizeOverpassResponse(raw);
  });

  try {
    return await hedgedRace(attempts, { staggerMs: OVERPASS_STAGGER_MS, deadlineMs: OVERPASS_BUDGET_MS, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    const failures = (error instanceof AggregateError ? error.errors : [error]).map((e) =>
      e instanceof Error ? e.message : String(e),
    );
    const summary =
      error instanceof RaceTimeoutError
        ? `No Overpass mirror answered within ${OVERPASS_BUDGET_MS} ms`
        : "All Overpass mirrors failed";
    throw new UpstreamError(failures.length > 0 ? `${summary}: ${failures.join(" | ")}` : summary);
  }
}
