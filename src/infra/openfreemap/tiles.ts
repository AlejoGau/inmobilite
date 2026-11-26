import { z } from "zod";
import type { LngLat } from "@/domain/types";
import { tilesCoveringRadius, tileUrl, type TileId } from "@/domain/geo/tiles";
import { UpstreamError, USER_AGENT } from "../http/fetchJson";
import { decodeVectorTile, type TileFeature } from "../tiles/vectorTile";
import { clipGeometry, tileBounds } from "./clipToTile";

/**
 * Streets, parks, POIs and (outside CABA) building footprints from the
 * OpenFreeMap vector tiles: the same tiles the flight map already loads,
 * served from a CDN that stays up when the public Overpass mirrors do not.
 */

export const OPENFREEMAP_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
export const OPENFREEMAP_ATTRIBUTION = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";
/** The planet tileset's maxzoom: the only zoom with every street, path and building. */
export const OPENFREEMAP_ZOOM = 14;
export const OPENFREEMAP_LAYERS = ["transportation", "transportation_name", "landcover", "landuse", "poi", "building"] as const;
/** The whole fetch, TileJSON included, gets this long by default. */
export const OPENFREEMAP_BUDGET_MS = 8_000;
/**
 * The tile URLs carry a dated build ("…/planet/20261122_124456_pt/…") that is
 * replaced every few days, and an old build eventually disappears. An hour
 * keeps the TileJSON off the critical path without serving a dead build for long.
 */
export const TILEJSON_TTL_MS = 60 * 60 * 1000;
/** A 404 forces a TileJSON refresh, but at most this often: a 404 can also mean an empty tile. */
const MIN_REFRESH_INTERVAL_MS = 60 * 1000;
/**
 * The TileJSON download is shared by concurrent requests, so it runs on its
 * own timeout instead of the signal of whichever request started it.
 */
const TILEJSON_TIMEOUT_MS = 5_000;

/** A decoded feature plus the tile it came from, already clipped to that tile's exact bounds. */
export interface OpenFreeMapFeature extends TileFeature {
  tile: TileId;
}

export interface FetchOpenFreeMapOptions {
  signal?: AbortSignal;
  budgetMs?: number;
}

export interface OpenFreeMapClientDeps {
  fetch?: typeof fetch;
  /** Clock for the TileJSON cache. */
  now?: () => number;
  tileJsonUrl?: string;
}

export interface OpenFreeMapClient {
  fetchFeatures(origin: LngLat, radiusM: number, options?: FetchOpenFreeMapOptions): Promise<OpenFreeMapFeature[]>;
}

const tileJsonSchema = z.object({ tiles: z.array(z.string()).min(1) });

type TileResult =
  | { kind: "data"; bytes: Uint8Array }
  | { kind: "empty" }
  | { kind: "missing" }
  | { kind: "failed"; error: unknown };

interface CachedTemplate {
  template: string;
  fetchedAt: number;
}

/**
 * Decodes one OpenFreeMap tile and clips every geometry to the tile's exact
 * bounds (see clipToTile.ts for why). Pure: the fixtures in tests go through
 * the same path as live tiles.
 */
export function decodeOpenFreeMapTile(bytes: Uint8Array, tile: TileId): OpenFreeMapFeature[] {
  const bounds = tileBounds(tile);
  const features: OpenFreeMapFeature[] = [];
  for (const feature of decodeVectorTile(bytes, tile, OPENFREEMAP_LAYERS)) {
    const geometry = clipGeometry(feature.geometry, bounds);
    if (geometry) features.push({ ...feature, geometry, tile });
  }
  return features;
}

export function createOpenFreeMapClient(deps: OpenFreeMapClientDeps = {}): OpenFreeMapClient {
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const tileJsonUrl = deps.tileJsonUrl ?? OPENFREEMAP_TILEJSON_URL;

  let cached: CachedTemplate | null = null;
  // Concurrent requests share one TileJSON download instead of racing to refresh it.
  let pending: Promise<string> | null = null;

  async function downloadTemplate(): Promise<string> {
    const response = await fetchImpl(tileJsonUrl, {
      signal: AbortSignal.timeout(TILEJSON_TIMEOUT_MS),
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    if (!response.ok) throw new UpstreamError(`HTTP ${response.status} from ${tileJsonUrl}`, response.status);
    const parsed = tileJsonSchema.safeParse(await response.json());
    if (!parsed.success) throw new UpstreamError(`Unexpected TileJSON from ${tileJsonUrl}`);
    return parsed.data.tiles[0];
  }

  async function getTemplate(signal: AbortSignal, forceRefresh = false): Promise<string> {
    const fresh = cached !== null && now() - cached.fetchedAt < TILEJSON_TTL_MS;
    if (cached && fresh && !forceRefresh) return cached.template;
    if (!pending) {
      pending = downloadTemplate()
        .then((template) => {
          cached = { template, fetchedAt: now() };
          return template;
        })
        .finally(() => {
          pending = null;
        });
    }
    try {
      return await untilAborted(pending, signal);
    } catch (error) {
      // A stale build still serves tiles for a while: better than failing the whole area.
      if (cached && !signal.aborted) return cached.template;
      throw error;
    }
  }

  async function fetchTile(template: string, tile: TileId, signal: AbortSignal): Promise<TileResult> {
    try {
      const response = await fetchImpl(tileUrl(template, tile), {
        signal,
        headers: { Accept: "application/x-protobuf", "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      if (response.status === 204) return { kind: "empty" };
      // Told apart from 204 (unlike fetchVectorTile): a 404 may mean the dated build is gone.
      if (response.status === 404) return { kind: "missing" };
      if (!response.ok) return { kind: "failed", error: new UpstreamError(`HTTP ${response.status} for tile`, response.status) };
      return { kind: "data", bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch (error) {
      return { kind: "failed", error };
    }
  }

  async function fetchAll(template: string, tiles: TileId[], signal: AbortSignal): Promise<TileResult[]> {
    return Promise.all(tiles.map((tile) => fetchTile(template, tile, signal)));
  }

  /** Re-fetches the 404 tiles once with a refreshed template, when the build has changed. */
  async function retryMissing(template: string, tiles: TileId[], results: TileResult[], signal: AbortSignal): Promise<TileResult[]> {
    const missing = results.flatMap((r, i) => (r.kind === "missing" ? [i] : []));
    const recentlyFetched = cached !== null && now() - cached.fetchedAt < MIN_REFRESH_INTERVAL_MS;
    if (missing.length === 0 || recentlyFetched) return results;
    const refreshed = await getTemplate(signal, true);
    if (refreshed === template) return results;
    const retried = await fetchAll(refreshed, missing.map((i) => tiles[i]), signal);
    const merged = results.slice();
    missing.forEach((index, k) => {
      merged[index] = retried[k];
    });
    return merged;
  }

  async function fetchFeatures(origin: LngLat, radiusM: number, options: FetchOpenFreeMapOptions = {}): Promise<OpenFreeMapFeature[]> {
    const budgetMs = options.budgetMs ?? OPENFREEMAP_BUDGET_MS;
    const deadline = AbortSignal.timeout(budgetMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const tiles = tilesCoveringRadius(origin, radiusM, OPENFREEMAP_ZOOM);

    const failIfOutOfTime = (error?: unknown): void => {
      // A caller abort propagates as-is, so the route stops work; running out of budget is an upstream failure.
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      if (deadline.aborted) throw new UpstreamError(`OpenFreeMap took longer than ${budgetMs} ms`);
    };

    let results: TileResult[];
    try {
      const template = await getTemplate(signal);
      results = await fetchAll(template, tiles, signal);
      results = await retryMissing(template, tiles, results, signal);
    } catch (error) {
      failIfOutOfTime(error);
      throw error;
    }
    failIfOutOfTime();

    // A 404 that survived the refresh counts as a failure here: a city never has every tile empty.
    if (!results.some((r) => r.kind === "data" || r.kind === "empty")) {
      const first = results.find((r) => r.kind === "failed");
      const reason = first ? (first.error instanceof Error ? first.error.message : String(first.error)) : "HTTP 404";
      throw new UpstreamError(`Every OpenFreeMap tile failed: ${reason}`);
    }
    // Tile order is stable (row by row), and so is each tile's feature order: the output is deterministic.
    return results.flatMap((r, i) => (r.kind === "data" ? decodeOpenFreeMapTile(r.bytes, tiles[i]) : []));
  }

  return { fetchFeatures };
}

/** Settles with the promise, or rejects as soon as the signal aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const defaultClient = createOpenFreeMapClient();

/**
 * Every OpenFreeMap feature within `radiusM` of the origin (the caller passes
 * the area radius plus ROAD_CLIP_MARGIN), clipped tile by tile. Throws when
 * the budget runs out or every tile fails; a single failed tile only leaves a
 * hole, which beats no scene at all.
 */
export function fetchOpenFreeMapFeatures(origin: LngLat, radiusM: number, options?: FetchOpenFreeMapOptions): Promise<OpenFreeMapFeature[]> {
  return defaultClient.fetchFeatures(origin, radiusM, options);
}
