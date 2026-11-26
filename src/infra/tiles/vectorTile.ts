import { gunzipSync } from "node:zlib";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { Geometry } from "geojson";
import type { TileId } from "@/domain/geo/tiles";

/**
 * Shared reader for Mapbox Vector Tiles (MVT/PBF), used by the GCBA 3D city
 * model and by OpenFreeMap. Server-side only (node:zlib): the API routes fetch
 * and decode tiles, and the browser only receives the finished AreaModel.
 */

export type TileProperties = Record<string, string | number | boolean>;

export interface TileFeature {
  /** Source layer name inside the tile, e.g. "default", "transportation". */
  layer: string;
  /** Feature id, when the tile carries one. */
  id?: number;
  /** Geometry in WGS84 lng/lat, already converted from tile coordinates. */
  geometry: Geometry;
  properties: TileProperties;
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * Decodes the requested layers of one tile into lng/lat features. Layers the
 * tile does not contain are skipped. The order is the tile's own order, so
 * decoding is deterministic.
 */
export function decodeVectorTile(bytes: Uint8Array, tile: TileId, layers: readonly string[]): TileFeature[] {
  const vt = new VectorTile(new PbfReader(maybeGunzip(bytes)));
  const features: TileFeature[] = [];
  for (const name of layers) {
    const layer = vt.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const raw = layer.feature(i);
      const geojson = raw.toGeoJSON(tile.x, tile.y, tile.z);
      const feature: TileFeature = {
        layer: name,
        geometry: geojson.geometry,
        properties: (raw.properties ?? {}) as TileProperties,
      };
      if (typeof raw.id === "number") feature.id = raw.id;
      features.push(feature);
    }
  }
  return features;
}

/**
 * Servers normally send tiles with Content-Encoding: gzip, which fetch undoes.
 * Some send the gzip bytes as the body instead, so check the magic number.
 */
function maybeGunzip(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1) return gunzipSync(bytes);
  return bytes;
}

export interface FetchTileOptions {
  signal?: AbortSignal;
  /** Per-tile timeout. */
  timeoutMs: number;
  userAgent?: string;
}

const DEFAULT_USER_AGENT = "inmobilite/0.1";

/**
 * Downloads one tile. Returns null for an empty tile (204, or 404, which tile
 * servers use for "nothing here"). Throws on network errors, timeouts and
 * other HTTP errors.
 */
export async function fetchVectorTile(url: string, options: FetchTileOptions): Promise<Uint8Array | null> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, {
    signal,
    headers: { "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT, Accept: "application/x-protobuf" },
  });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}
