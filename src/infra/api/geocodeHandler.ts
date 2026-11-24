import type { GeocodeResponse } from "@/domain/types";
import { LruCache } from "../cache/lruCache";
import { DEFAULT_PROVIDERS, geocodeWithProviders, type GeocodeOutcome } from "../geocoding";
import { errorResult, NO_STORE, type ApiResult } from "./apiResult";

export const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 200;
const CACHE_CAPACITY = 200;
const CACHE_TTL_MS = 60 * 60 * 1000;
/** Same corner, same answer: browsers and CDNs can keep it a while. */
const CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export interface GeocodeHandlerDeps {
  geocode: (q: string, signal?: AbortSignal) => Promise<GeocodeOutcome>;
  cache: LruCache<GeocodeResponse>;
}

export type GeocodeHandler = (rawQuery: string | null, signal?: AbortSignal) => Promise<ApiResult<GeocodeResponse>>;

/** Collapses whitespace, so "acoyte  y riva " and "acoyte y riva" share a cache entry. */
export function normalizeQuery(raw: string | null): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

export function createGeocodeHandler({ geocode, cache }: GeocodeHandlerDeps): GeocodeHandler {
  return async (rawQuery, signal) => {
    const query = normalizeQuery(rawQuery);
    if (query.length < MIN_QUERY_LENGTH) {
      return errorResult(400, `Escribí al menos ${MIN_QUERY_LENGTH} caracteres.`);
    }
    if (query.length > MAX_QUERY_LENGTH) return errorResult(400, "La búsqueda es demasiado larga.");

    const key = query.toLocaleLowerCase("es-AR");
    const cached = cache.get(key);
    if (cached) return { status: 200, body: { ...cached, query }, headers: { "Cache-Control": CACHE_CONTROL } };

    const outcome = await geocode(query, signal);
    if (outcome.allFailed) {
      return errorResult(502, "El buscador de direcciones no responde. Probá de nuevo en unos segundos.");
    }

    const body: GeocodeResponse = { query, results: outcome.results };
    // With a provider down, the answer came from a worse fallback (or is wrongly empty): serve it, but do not keep it.
    const reliable = !outcome.degraded;
    if (reliable) cache.set(key, body, CACHE_TTL_MS);
    return { status: 200, body, headers: reliable ? { "Cache-Control": CACHE_CONTROL } : { ...NO_STORE } };
  };
}

export const geocodeHandler: GeocodeHandler = createGeocodeHandler({
  geocode: (q, signal) => geocodeWithProviders(q, DEFAULT_PROVIDERS, signal),
  cache: new LruCache<GeocodeResponse>(CACHE_CAPACITY),
});
