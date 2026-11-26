import { tilesCoveringRadius, tileUrl, type TileId } from "@/domain/geo/tiles";
import { removeHoles, type LngLatPosition, type PolygonCoordinates, type TejidoPiece } from "@/domain/area/gcbaBuildings";
import type { LngLat } from "@/domain/types";
import { decodeVectorTile, fetchVectorTile, type FetchTileOptions } from "../tiles/vectorTile";
import { clipPolygonToBounds, polygonsOf, tileBounds } from "./tileClip";

export type { TejidoPiece } from "@/domain/area/gcbaBuildings";

/**
 * Client for the Buenos Aires city government's 3D city model, "Tejido
 * Urbano" (photogrammetry, one feature per building volume). It has the
 * real height of almost every building in CABA, including towers that
 * OpenStreetMap barely has. CABA only: elsewhere the tiles come back empty.
 * No key, CORS open.
 */

export const TEJIDO_TILE_URL = "https://vectortiles.usig.buenosaires.gob.ar/cur3d/tejido/{z}/{x}/{y}.pbf?optimize=true";
/**
 * The service serves z10-18. At z17 a tile is about 250 m wide here, so a
 * 160 m radius takes 4-6 tiles, and the pieces are not yet simplified.
 */
export const TEJIDO_ZOOM = 17;
export const TEJIDO_LAYER = "default";
/** CC BY 2.5 AR requires the credit wherever the volumes are shown. */
export const TEJIDO_ATTRIBUTION = "Volumetría: Tejido Urbano, GCBA (CC BY 2.5 AR)";

/** A tile normally answers in well under a second; past this it is treated as failed. */
export const TEJIDO_TILE_TIMEOUT_MS = 4_000;
/** The whole call, every tile included, gets this long by default. */
export const TEJIDO_BUDGET_MS = 6_000;

/** Downloads one tile: its bytes, or null when the tile is empty. Injected in tests. */
export type TileFetcher = (url: string, options: FetchTileOptions) => Promise<Uint8Array | null>;

export interface FetchTejidoOptions {
  signal?: AbortSignal;
  /** Upper bound for the whole call, in ms. */
  budgetMs?: number;
  fetchTile?: TileFetcher;
}

/**
 * The tejido pieces within (a square superset of) the radius, clipped to
 * their tiles so that no two overlap. Returns null when every tile is empty,
 * which means the origin is outside CABA. Throws when a tile fails or the
 * budget runs out, so the caller can fall back to another source: a partial
 * answer would leave a hole in the middle of the block.
 */
export async function fetchTejidoPieces(
  origin: LngLat,
  radiusM: number,
  opts: FetchTejidoOptions = {},
): Promise<TejidoPiece[] | null> {
  const tiles = tilesCoveringRadius(origin, radiusM, TEJIDO_ZOOM);
  const fetchTile = opts.fetchTile ?? fetchVectorTile;
  // One failed tile aborts its siblings: their bytes would be thrown away anyway.
  const siblings = new AbortController();
  const signals = [siblings.signal, AbortSignal.timeout(opts.budgetMs ?? TEJIDO_BUDGET_MS)];
  if (opts.signal) signals.push(opts.signal);
  const signal = AbortSignal.any(signals);

  const downloads = tiles.map((tile) =>
    fetchTile(tileUrl(TEJIDO_TILE_URL, tile), { signal, timeoutMs: TEJIDO_TILE_TIMEOUT_MS }),
  );
  let bodies: (Uint8Array | null)[];
  try {
    bodies = await untilAborted(Promise.all(downloads), signal);
  } finally {
    siblings.abort();
  }

  const pieces = tiles.flatMap((tile, i) => {
    const bytes = bodies[i];
    return bytes ? decodeTejidoTile(bytes, tile) : [];
  });
  return pieces.length > 0 ? pieces : null;
}

/**
 * Rejects as soon as the signal aborts, even if the work ignores the signal
 * (an injected fetcher, a body stuck mid-stream), so the budget really bounds the call.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Decodes one tejido tile into pieces: every polygon clipped to the tile's
 * exact bounds (see tileClip.ts) and cut free of holes. Features without a
 * parcel or a piece id are skipped. Voids (altura 0) are kept: telling a
 * patio from a volume is the domain's call.
 */
export function decodeTejidoTile(bytes: Uint8Array, tile: TileId): TejidoPiece[] {
  const bounds = tileBounds(tile);
  const pieces: TejidoPiece[] = [];
  for (const feature of decodeVectorTile(bytes, tile, [TEJIDO_LAYER])) {
    const { smp, id, altura } = feature.properties;
    if (typeof smp !== "string" || smp === "" || typeof id !== "number") continue;
    const rings = polygonsOf(feature.geometry)
      .flatMap((polygon) => clipPolygonToBounds(polygon, bounds))
      .flatMap((polygon) => removeHoles(polygon))
      .map(outerRing);
    if (rings.length === 0) continue;
    pieces.push({ pieceId: id, smp, height: typeof altura === "number" ? altura : 0, rings });
  }
  return pieces;
}

/** The outer ring as [lng, lat] pairs, without GeoJSON's repeated closing point. */
function outerRing(polygon: PolygonCoordinates): LngLatPosition[] {
  const ring = polygon[0].map((p): LngLatPosition => [p[0], p[1]]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
  return ring;
}
