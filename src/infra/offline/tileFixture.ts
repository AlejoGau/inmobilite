import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TileSources } from "@/domain/area/areaFromTiles";
import { tilesCoveringRadius, type TileId } from "@/domain/geo/tiles";
import type { LngLat } from "@/domain/types";
import { decodeTejidoTile, TEJIDO_ZOOM } from "../gcba/tejido";
import { decodeOpenFreeMapTile, OPENFREEMAP_ZOOM } from "../openfreemap/tiles";

/**
 * Real tiles saved around Av. Acoyte y Av. Rivadavia (Caballito), served when
 * OpenFreeMap is down so the live demo never breaks. They go through the very
 * same decoders and pipeline as live tiles; only the download is skipped.
 * The files are the test fixtures, so there is one copy of the data.
 */

/** Origin of the fixture: Av. Acoyte y Av. Rivadavia. */
export const FIXTURE_ORIGIN: LngLat = { lat: -34.6183, lng: -58.43646 };

const OPENFREEMAP_DIR = "src/infra/openfreemap/__fixtures__";
const GCBA_DIR = "src/infra/gcba/__fixtures__";

/** The tiles on disk (OpenFreeMap build 20261122_124456_pt, GCBA tejido, both saved on 2026-11-25). */
export const FIXTURE_OPENFREEMAP_TILES: readonly TileId[] = [
  { z: 14, x: 5532, y: 9872 },
  { z: 14, x: 5532, y: 9873 },
];
export const FIXTURE_GCBA_TILES: readonly TileId[] = [44259, 44260].flatMap((x) =>
  [78984, 78985, 78986].map((y) => ({ z: 17, x, y })),
);

export interface FixtureRadii {
  /** What the live OpenFreeMap fetch would ask for: the area radius plus the road clip margin. */
  contextM: number;
  /** What the live GCBA fetch would ask for. */
  buildingsM: number;
}

/**
 * The fixture serves an origin only when every tile the live fetch would
 * download for it is on disk. A partial set would cut the scene on one side,
 * which is worse than the honest 503.
 */
export function isCoveredByFixture(origin: LngLat, radii: FixtureRadii): boolean {
  return (
    covers(FIXTURE_OPENFREEMAP_TILES, tilesCoveringRadius(origin, radii.contextM, OPENFREEMAP_ZOOM)) &&
    covers(FIXTURE_GCBA_TILES, tilesCoveringRadius(origin, radii.buildingsM, TEJIDO_ZOOM))
  );
}

function covers(saved: readonly TileId[], needed: readonly TileId[]): boolean {
  const keys = new Set(saved.map(tileKey));
  return needed.every((tile) => keys.has(tileKey(tile)));
}

function tileKey(tile: TileId): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** The decoded fixture tiles for a covered origin, or null. Read lazily: the happy path never needs them. */
export async function loadTileFixture(origin: LngLat, radii: FixtureRadii): Promise<TileSources | null> {
  if (!isCoveredByFixture(origin, radii)) return null;
  const root = process.cwd();
  const [ofm, gcba] = await Promise.all([
    Promise.all(
      FIXTURE_OPENFREEMAP_TILES.map(async (tile) =>
        decodeOpenFreeMapTile(new Uint8Array(await readFile(path.join(root, OPENFREEMAP_DIR, `ofm-${tile.z}-${tile.x}-${tile.y}.pbf`))), tile),
      ),
    ),
    Promise.all(
      // Saved gzipped, as the server sends them; the decoder unzips.
      FIXTURE_GCBA_TILES.map(async (tile) =>
        decodeTejidoTile(new Uint8Array(await readFile(path.join(root, GCBA_DIR, `tejido-${tile.z}-${tile.x}-${tile.y}.pbf.gz`))), tile),
      ),
    ),
  ]);
  return { features: ofm.flat(), tejido: gcba.flat() };
}
