import { z } from "zod";
import type { AreaModel, LngLat } from "@/domain/types";
import { buildOverpassQuery, type OverpassResponse } from "@/domain/osm/overpass";
import { buildArea } from "@/domain/area/buildArea";
import { LruCache } from "../cache/lruCache";
import { fetchOverpass } from "../osm/overpassClient";
import { loadOfflineFallback } from "../osm/offlineFallback";
import { errorResult, type ApiResult } from "./apiResult";

const CACHE_CAPACITY = 200;
/** OSM changes slowly; a few hours of staleness is invisible. */
const LIVE_TTL_MS = 6 * 60 * 60 * 1000;
/** The fallback is kept briefly, so the live data takes over as soon as Overpass is back. */
const FALLBACK_TTL_MS = 2 * 60 * 1000;
const LIVE_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
const FALLBACK_CACHE_CONTROL = "public, max-age=60";
/** Coordinates are rounded to this many decimals (~1 m) for the cache key and the model origin. */
const COORD_DECIMALS = 5;

export type AreaSource = "osm" | "fixture";

interface AreaEntry {
  model: AreaModel;
  source: AreaSource;
}

export interface AreaHandlerDeps {
  fetchOverpass: (query: string) => Promise<OverpassResponse>;
  loadFallback: (origin: LngLat) => Promise<OverpassResponse | null>;
  cache: LruCache<AreaEntry>;
}

export type AreaHandler = (rawLat: string | null, rawLng: string | null) => Promise<ApiResult<AreaModel>>;

/** A coordinate query param: required, numeric, within range. Empty strings are not 0. */
const coordinate = (min: number, max: number) =>
  z.string().trim().min(1).transform(Number).pipe(z.number().min(min).max(max));

const paramsSchema = z.object({ lat: coordinate(-90, 90), lng: coordinate(-180, 180) });

export function parseAreaParams(rawLat: string | null, rawLng: string | null): LngLat | null {
  const parsed = paramsSchema.safeParse({ lat: rawLat ?? "", lng: rawLng ?? "" });
  if (!parsed.success) return null;
  return { lat: roundCoord(parsed.data.lat), lng: roundCoord(parsed.data.lng) };
}

function roundCoord(n: number): number {
  return Number(n.toFixed(COORD_DECIMALS));
}

export function createAreaHandler(deps: AreaHandlerDeps): AreaHandler {
  // Concurrent requests for the same corner share one Overpass call.
  const inFlight = new Map<string, Promise<AreaEntry | null>>();

  /** Live data, or the bundled fixture when Overpass is down. Only the fetch is guarded: a bug in buildArea must surface. */
  const fetchOsm = async (origin: LngLat): Promise<{ osm: OverpassResponse; source: AreaSource } | null> => {
    try {
      return { osm: await deps.fetchOverpass(buildOverpassQuery(origin)), source: "osm" };
    } catch (error) {
      console.warn("[area] Overpass failed:", error instanceof Error ? error.message : error);
      const fallback = await deps.loadFallback(origin);
      return fallback ? { osm: fallback, source: "fixture" } : null;
    }
  };

  const load = async (origin: LngLat): Promise<AreaEntry | null> => {
    const data = await fetchOsm(origin);
    if (!data) return null;
    const entry: AreaEntry = { model: buildArea({ origin, osm: data.osm }), source: data.source };
    deps.cache.set(keyOf(origin), entry, data.source === "osm" ? LIVE_TTL_MS : FALLBACK_TTL_MS);
    return entry;
  };

  return async (rawLat, rawLng) => {
    const origin = parseAreaParams(rawLat, rawLng);
    if (!origin) return errorResult(400, "Coordenadas inválidas: lat entre -90 y 90, lng entre -180 y 180.");

    const key = keyOf(origin);
    let entry: AreaEntry | null | undefined = deps.cache.get(key);
    if (!entry) {
      let pending = inFlight.get(key);
      if (!pending) {
        pending = load(origin).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      entry = await pending;
    }

    if (!entry) {
      return errorResult(503, "No pudimos traer los datos del mapa de esta zona. Probá de nuevo en un rato.");
    }
    return {
      status: 200,
      body: entry.model,
      headers: {
        "Cache-Control": entry.source === "osm" ? LIVE_CACHE_CONTROL : FALLBACK_CACHE_CONTROL,
        "X-Area-Source": entry.source,
      },
    };
  };
}

function keyOf(origin: LngLat): string {
  return `${origin.lat.toFixed(COORD_DECIMALS)},${origin.lng.toFixed(COORD_DECIMALS)}`;
}

export const areaHandler: AreaHandler = createAreaHandler({
  // No request signal on purpose: the work is shared between requests and its result is cached,
  // so one client leaving must not cancel it for the others. Mirror timeouts bound it.
  fetchOverpass: (query) => fetchOverpass(query),
  loadFallback: loadOfflineFallback,
  cache: new LruCache<AreaEntry>(CACHE_CAPACITY),
});
