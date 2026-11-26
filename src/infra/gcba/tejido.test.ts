import { readFileSync } from "node:fs";
import path from "node:path";
import { intersect } from "@turf/intersect";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import type { Position } from "geojson";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjection } from "@/domain/geo/projection";
import { polygonArea } from "@/domain/geo/polygon";
import { lngToTileX, latToTileY, tilesCoveringRadius, type TileId } from "@/domain/geo/tiles";
import type { Vec2 } from "@/domain/types";
import { decodeVectorTile } from "../tiles/vectorTile";
import { decodeTejidoTile, fetchTejidoPieces, TEJIDO_TILE_URL, type TileFetcher } from "./tejido";
import { polygonsOf, tileBounds } from "./tileClip";

const ACOYTE_Y_RIVADAVIA = { lng: -58.43646, lat: -34.6183 };
const FIXTURES = path.join(__dirname, "__fixtures__");
const projection = createProjection(ACOYTE_Y_RIVADAVIA);

/** Real z17 tiles saved on 2026-11-25, gzipped as the server sends them. */
function fixture(tile: TileId): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, `tejido-17-${tile.x}-${tile.y}.pbf.gz`)));
}

function tileFromUrl(url: string): TileId {
  const match = /\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(url);
  if (!match) throw new Error(`not a tile url: ${url}`);
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

/** Area in m² of the overlap of two lng/lat rings. */
function overlapM2(a: Position[], b: Position[]): number {
  const close = (r: Position[]) => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]);
  const shared = intersect(featureCollection([turfPolygon([close(a)]), turfPolygon([close(b)])]));
  if (!shared) return 0;
  const polygons = shared.geometry.type === "Polygon" ? [shared.geometry.coordinates] : shared.geometry.coordinates;
  return polygons.reduce((sum, poly) => sum + polygonArea(poly[0].map((p): Vec2 => projection.toLocal(p[0], p[1]))), 0);
}

const WEST: TileId = { z: 17, x: 44259, y: 78985 };
const EAST: TileId = { z: 17, x: 44260, y: 78985 };
/** A podium piece of 045-079-013B that straddles the edge between WEST and EAST. */
const STRADDLING_PIECE = 728921;

describe("tileBounds", () => {
  it("matches the tile maths and makes neighbours share their edge exactly", () => {
    const west = tileBounds(WEST);
    expect(lngToTileX(west.minX, 17)).toBeCloseTo(WEST.x, 9);
    expect(latToTileY(west.maxY, 17)).toBeCloseTo(WEST.y, 9);
    expect(west.minY).toBeLessThan(west.maxY);
    expect(tileBounds(EAST).minX).toBe(west.maxX);
    expect(tileBounds({ ...WEST, y: WEST.y + 1 }).maxY).toBe(west.minY);
  });
});

describe("decodeTejidoTile", () => {
  const pieces = decodeTejidoTile(fixture(WEST), WEST);

  it("reads the pieces with their parcel, id and height", () => {
    expect(pieces.length).toBeGreaterThan(900);
    const tower = pieces.filter((p) => p.smp === "045-068-019");
    expect(Math.max(...tower.map((p) => p.height))).toBeCloseTo(44.8, 5);
    expect(pieces.every((p) => Number.isInteger(p.pieceId) && p.smp.length > 0 && p.rings.length > 0)).toBe(true);
  });

  it("clips every ring to the tile's exact bounds", () => {
    const b = tileBounds(WEST);
    for (const p of pieces) {
      for (const ring of p.rings) {
        for (const [lng, lat] of ring) {
          expect(lng).toBeGreaterThanOrEqual(b.minX);
          expect(lng).toBeLessThanOrEqual(b.maxX);
          expect(lat).toBeGreaterThanOrEqual(b.minY);
          expect(lat).toBeLessThanOrEqual(b.maxY);
        }
      }
    }
  });

  it("emits open rings (no repeated closing point)", () => {
    for (const p of pieces) {
      for (const ring of p.rings) {
        expect(ring.length).toBeGreaterThanOrEqual(3);
        expect(ring[0]).not.toEqual(ring[ring.length - 1]);
      }
    }
  });

  it("turns the copies of a straddling piece from overlapping into abutting (tile-edge rule)", () => {
    // Raw MVT: both tiles carry the piece, buffer included, so the copies overlap.
    const raw = (tile: TileId) =>
      decodeVectorTile(fixture(tile), tile, ["default"])
        .filter((f) => f.properties.id === STRADDLING_PIECE)
        .flatMap((f) => polygonsOf(f.geometry).map((poly) => poly[0]));
    const [rawWest] = raw(WEST);
    const [rawEast] = raw(EAST);
    expect(overlapM2(rawWest, rawEast)).toBeGreaterThan(1);

    const clipped = (tile: TileId) => decodeTejidoTile(fixture(tile), tile).filter((p) => p.pieceId === STRADDLING_PIECE).flatMap((p) => p.rings);
    const west = clipped(WEST);
    const east = clipped(EAST);
    expect(west.length).toBeGreaterThan(0);
    expect(east.length).toBeGreaterThan(0);
    for (const a of west) for (const b of east) expect(overlapM2(a, b)).toBeLessThan(0.01);
  });

  it("is deterministic", () => {
    expect(decodeTejidoTile(fixture(WEST), WEST)).toEqual(pieces);
  });
});

describe("fetchTejidoPieces", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fromFixtures: TileFetcher = async (url) => fixture(tileFromUrl(url));

  it("downloads every z17 tile covering the radius and decodes them all", async () => {
    const urls: string[] = [];
    const fetchTile: TileFetcher = async (url, options) => {
      urls.push(url);
      expect(options.timeoutMs).toBeGreaterThan(0);
      return fromFixtures(url, options);
    };
    const pieces = await fetchTejidoPieces(ACOYTE_Y_RIVADAVIA, 160, { fetchTile });
    const tiles = tilesCoveringRadius(ACOYTE_Y_RIVADAVIA, 160, 17);
    expect(tiles).toHaveLength(6);
    expect(urls.map(tileFromUrl)).toEqual(tiles);
    expect(urls[0]).toMatch(/^https:\/\/vectortiles\.usig\.buenosaires\.gob\.ar\/cur3d\/tejido\/17\/\d+\/\d+\.pbf\?optimize=true$/);
    expect(urls[0].startsWith(TEJIDO_TILE_URL.split("{z}")[0])).toBe(true);
    const smps = new Set(pieces?.map((p) => p.smp));
    for (const smp of ["040-088-010", "045-068-019", "040-088-009D", "045-079-013B"]) expect(smps.has(smp)).toBe(true);
  });

  it("returns null when every tile is empty (outside CABA)", async () => {
    const empty: TileFetcher = async () => null;
    await expect(fetchTejidoPieces({ lng: -60.64, lat: -32.95 }, 160, { fetchTile: empty })).resolves.toBeNull();
  });

  it("maps 404 and 204 answers to empty tiles through the default fetcher", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => new Response(null, { status: call++ % 2 === 0 ? 404 : 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTejidoPieces(ACOYTE_Y_RIVADAVIA, 160)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("throws when one tile fails, and aborts the other downloads", async () => {
    const signals: AbortSignal[] = [];
    const fetchTile: TileFetcher = (url, options) => {
      if (options.signal) signals.push(options.signal);
      const tile = tileFromUrl(url);
      if (tile.x === EAST.x && tile.y === EAST.y) return Promise.reject(new Error("HTTP 500 from tejido"));
      return new Promise<never>(() => {}); // the rest hang
    };
    await expect(fetchTejidoPieces(ACOYTE_Y_RIVADAVIA, 160, { fetchTile })).rejects.toThrow("HTTP 500");
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("throws on an HTTP error through the default fetcher", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 502 })));
    await expect(fetchTejidoPieces(ACOYTE_Y_RIVADAVIA, 160)).rejects.toThrow(/HTTP 502/);
  });

  it("gives up when the budget runs out, even if a fetcher ignores the signal", async () => {
    const hang: TileFetcher = () => new Promise<never>(() => {});
    await expect(fetchTejidoPieces(ACOYTE_Y_RIVADAVIA, 160, { fetchTile: hang, budgetMs: 30 })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("stops when the caller aborts", async () => {
    const hang: TileFetcher = () => new Promise<never>(() => {});
    const controller = new AbortController();
    const pending = fetchTejidoPieces(ACOYTE_Y_RIVADAVIA, 160, { fetchTile: hang, signal: controller.signal });
    controller.abort(new Error("visitor left"));
    await expect(pending).rejects.toThrow("visitor left");
  });
});
