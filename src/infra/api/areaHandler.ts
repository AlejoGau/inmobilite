import { z } from "zod";
import type { AreaModel, LngLat } from "@/domain/types";
import { BUILDING_SEARCH_RADIUS, buildComplementQuery, DEFAULT_AREA_RADIUS, type OverpassResponse } from "@/domain/osm/overpass";
import { areaFromTiles, type TileSources } from "@/domain/area/areaFromTiles";
import { pickFeatured, withFacades, type FacadePhotoSource } from "@/domain/area/facade";
import { complementFromOverpass, type OverpassComplement } from "@/domain/area/overpassComplement";
import type { TejidoPiece } from "@/domain/area/gcbaBuildings";
import type { VectorFeature } from "@/domain/area/tileContext";
import { ROAD_CLIP_MARGIN } from "@/domain/area/roads";
import { createProjection } from "@/domain/geo/projection";
import { LruCache } from "../cache/lruCache";
import { fetchFacadePhoto, isInCaba, reverseGeocodeSmp } from "../gcba/fotos";
import { fetchTejidoPieces } from "../gcba/tejido";
import { fetchOpenFreeMapFeatures } from "../openfreemap/tiles";
import { fetchOverpass } from "../osm/overpassClient";
import { loadTileFixture, type FixtureRadii } from "../offline/tileFixture";
import { errorResult, type ApiResult } from "./apiResult";

const CACHE_CAPACITY = 200;
/** Tiles and the GCBA model change slowly; a few hours of staleness is invisible. */
const LIVE_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * A model missing an optional source (GCBA failed, Overpass did not answer)
 * or built from the fixture is kept briefly, so the full data takes over as
 * soon as the services are back.
 */
const DEGRADED_TTL_MS = 2 * 60 * 1000;
const LIVE_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
const DEGRADED_CACHE_CONTROL = "public, max-age=60";
/** Coordinates are rounded to this many decimals (~1 m) for the cache key and the model origin. */
const COORD_DECIMALS = 5;
/** The Overpass complement only adds trees and names: not worth making the user wait longer than this. */
export const COMPLEMENT_BUDGET_MS = 3_000;
/**
 * Facade photos are a bonus on 3 buildings: each step (the reverse geocoding,
 * then the photo lookups, all in parallel) gets at most this long.
 */
export const FACADE_BUDGET_MS = 3_000;

/** What the tiles are fetched with: the same radii the domain clips to. */
export const AREA_RADII: FixtureRadii = {
  contextM: DEFAULT_AREA_RADIUS + ROAD_CLIP_MARGIN,
  buildingsM: BUILDING_SEARCH_RADIUS,
};

export type AreaSource = "tiles+gcba" | "tiles" | "fixture";

interface AreaEntry {
  model: AreaModel;
  source: AreaSource;
  /** Every source that should have answered did. */
  complete: boolean;
}

export interface AreaHandlerDeps {
  /** OpenFreeMap features within the radius. Required: without streets there is no scene. */
  fetchTileFeatures: (origin: LngLat, radiusM: number) => Promise<VectorFeature[]>;
  /** GCBA tejido pieces; null outside CABA. Optional: failures fall back to the tiles' footprints. */
  fetchTejido: (origin: LngLat, radiusM: number) => Promise<TejidoPiece[] | null>;
  /** Runs an Overpass query. Optional: any failure only costs the mapped trees and building names. */
  fetchOverpass: (query: string, signal: AbortSignal) => Promise<OverpassResponse>;
  /** The saved tiles, for origins they cover; null elsewhere. */
  loadFixture: (origin: LngLat) => Promise<TileSources | null>;
  /** The parcel (SMP) under a point in CABA, or null. Optional: without it the property is the building nearest the origin. */
  reverseGeocodeSmp?: (origin: LngLat, signal: AbortSignal) => Promise<string | null>;
  /** The newest facade photo of a parcel, or null. Optional: without it no building gets a photo. */
  fetchFacadePhoto?: (smp: string, signal: AbortSignal) => Promise<FacadePhotoSource | null>;
  cache: LruCache<AreaEntry>;
  complementBudgetMs?: number;
  facadeBudgetMs?: number;
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

type Outcome<T> = { ok: true; value: T } | { ok: false };

/** Only the fetches are guarded: a bug in the domain pipeline must surface, not turn into a fallback. */
async function settle<T>(label: string, work: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    console.warn(`[area] ${label} failed:`, error instanceof Error ? error.message : error);
    return { ok: false };
  }
}

/** Rejects after `ms` even if the work ignores the abort, so the budget really bounds the wait. */
function withBudget<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`no answer within ${ms} ms`));
    }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

export function createAreaHandler(deps: AreaHandlerDeps): AreaHandler {
  const complementBudgetMs = deps.complementBudgetMs ?? COMPLEMENT_BUDGET_MS;
  // Concurrent requests for the same corner share one set of fetches.
  const inFlight = new Map<string, Promise<AreaEntry | null>>();

  const fetchComplement = async (origin: LngLat): Promise<OverpassComplement> => {
    const osm = await withBudget(complementBudgetMs, (signal) => deps.fetchOverpass(buildComplementQuery(origin), signal));
    return complementFromOverpass(osm, createProjection(origin));
  };

  const facadeBudgetMs = deps.facadeBudgetMs ?? FACADE_BUDGET_MS;

  /** The searched parcel. Outside CABA there is no parcel to ask for, which is not a failure. */
  const fetchTargetSmp = async (origin: LngLat): Promise<Outcome<string | null>> => {
    const reverse = deps.reverseGeocodeSmp;
    if (!reverse || !isInCaba(origin)) return { ok: true, value: null };
    return settle("USIG reverse geocoding", () => withBudget(facadeBudgetMs, (signal) => reverse(origin, signal)));
  };

  /**
   * Picks the featured buildings and attaches the photos found for them.
   * One lookup failing only costs that building its photo; `ok` reports
   * whether every lookup answered, so a degraded model is not cached for long.
   */
  const attachFacades = async (model: AreaModel, targetSmp: string | null): Promise<{ model: AreaModel; ok: boolean }> => {
    const featured = pickFeatured(model, targetSmp);
    const lookup = deps.fetchFacadePhoto;
    const photos = new Map<string, FacadePhotoSource>();
    if (!lookup) return { model: withFacades(model, featured, photos), ok: true };
    const smps = model.buildings.filter((b) => featured.includes(b.id) && b.smp).map((b) => b.smp as string);
    const outcomes = await Promise.all(
      smps.map((smp) => settle(`USIG photos ${smp}`, () => withBudget(facadeBudgetMs, (signal) => lookup(smp, signal)))),
    );
    outcomes.forEach((outcome, i) => {
      if (outcome.ok && outcome.value) photos.set(smps[i], outcome.value);
    });
    return { model: withFacades(model, featured, photos), ok: outcomes.every((o) => o.ok) };
  };

  const live = async (origin: LngLat): Promise<AreaEntry | null> => {
    // All at once: the slowest optional source must not delay the required one.
    const [tiles, tejido, complement, targetSmp] = await Promise.all([
      settle("OpenFreeMap", () => deps.fetchTileFeatures(origin, AREA_RADII.contextM)),
      settle("GCBA tejido", () => deps.fetchTejido(origin, AREA_RADII.buildingsM)),
      settle("Overpass complement", () => fetchComplement(origin)),
      fetchTargetSmp(origin),
    ]);
    if (!tiles.ok) return null;
    const sources: TileSources = {
      features: tiles.value,
      tejido: tejido.ok ? tejido.value : null,
      ...(complement.ok ? { complement: complement.value } : {}),
    };
    // The photos are looked up per parcel, so they wait for the buildings; the parcel lookup did not.
    const facades = await attachFacades(areaFromTiles(origin, sources), targetSmp.ok ? targetSmp.value : null);
    const model = facades.model;
    const usedGcba = model.buildings.some((b) => b.heightSource === "gcba");
    return {
      model,
      source: usedGcba ? "tiles+gcba" : "tiles",
      complete: tejido.ok && complement.ok && targetSmp.ok && facades.ok,
    };
  };

  const offline = async (origin: LngLat): Promise<AreaEntry | null> => {
    const sources = await deps.loadFixture(origin);
    if (!sources) return null;
    // The services are down when the fixture is used: the featured buildings are marked, without photos.
    const base = areaFromTiles(origin, sources);
    return { model: withFacades(base, pickFeatured(base, null), new Map()), source: "fixture", complete: false };
  };

  const load = async (origin: LngLat): Promise<AreaEntry | null> => {
    const entry = (await live(origin)) ?? (await offline(origin));
    if (entry) deps.cache.set(keyOf(origin), entry, entry.complete ? LIVE_TTL_MS : DEGRADED_TTL_MS);
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
        "Cache-Control": entry.complete ? LIVE_CACHE_CONTROL : DEGRADED_CACHE_CONTROL,
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
  // so one client leaving must not cancel it for the others. Each client has its own overall budget.
  fetchTileFeatures: (origin, radiusM) => fetchOpenFreeMapFeatures(origin, radiusM),
  fetchTejido: (origin, radiusM) => fetchTejidoPieces(origin, radiusM),
  fetchOverpass: (query, signal) => fetchOverpass(query, signal),
  loadFixture: (origin) => loadTileFixture(origin, AREA_RADII),
  reverseGeocodeSmp: (origin, signal) => reverseGeocodeSmp(origin, signal),
  fetchFacadePhoto: (smp, signal) => fetchFacadePhoto(smp, signal),
  cache: new LruCache<AreaEntry>(CACHE_CAPACITY),
});
