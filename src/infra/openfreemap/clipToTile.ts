import { intersect } from "@turf/intersect";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import type { Geometry, Polygon, Position } from "geojson";
import type { TileId } from "@/domain/geo/tiles";

/**
 * MVT geometry carries a buffer past the tile edge, so a road or a park that
 * crosses an edge comes twice, once from each tile, and the copies OVERLAP in
 * the buffer. Drawn together they z-fight. Clipping every geometry to its
 * tile's exact bounds turns the copies into fragments that abut and never
 * overlap; the domain then stitches them back together.
 */

export interface LngLatBounds {
  west: number;
  east: number;
  north: number;
  south: number;
}

/**
 * Every OpenFreeMap and GCBA layer uses this extent. The bounds are computed
 * with the exact expression @mapbox/vector-tile uses to turn tile pixels into
 * lng/lat, so the edge shared by two tiles is bitwise the same number in both.
 */
const TILE_EXTENT = 4096;

export function tileBounds(tile: TileId): LngLatBounds {
  const size = TILE_EXTENT * 2 ** tile.z;
  const lngAt = (px: number) => (px * 360) / size - 180;
  const latAt = (py: number) => (360 / Math.PI) * Math.atan(Math.exp((1 - (py * 2) / size) * Math.PI)) - 90;
  return {
    west: lngAt(TILE_EXTENT * tile.x),
    east: lngAt(TILE_EXTENT * (tile.x + 1)),
    north: latAt(TILE_EXTENT * tile.y),
    south: latAt(TILE_EXTENT * (tile.y + 1)),
  };
}

/** The part of a geometry inside the bounds, or null when nothing is left. */
export function clipGeometry(geometry: Geometry, bounds: LngLatBounds): Geometry | null {
  switch (geometry.type) {
    case "Point":
      return ownsPoint(geometry.coordinates, bounds) ? geometry : null;
    case "MultiPoint": {
      const points = geometry.coordinates.filter((p) => ownsPoint(p, bounds));
      return points.length === 0 ? null : { type: "MultiPoint", coordinates: points };
    }
    case "LineString":
      return lineGeometry(clipLine(geometry.coordinates, bounds));
    case "MultiLineString":
      return lineGeometry(geometry.coordinates.flatMap((line) => clipLine(line, bounds)));
    case "Polygon":
      return polygonGeometry(clipPolygon(geometry.coordinates, bounds));
    case "MultiPolygon":
      return polygonGeometry(geometry.coordinates.flatMap((rings) => clipPolygon(rings, bounds)));
    default:
      // GeometryCollection never comes out of an MVT decoder.
      return null;
  }
}

/**
 * Half-open ownership (west and north edges inclusive, east and south
 * exclusive): a point exactly on a shared edge belongs to one tile only.
 */
function ownsPoint([lng, lat]: Position, b: LngLatBounds): boolean {
  return lng >= b.west && lng < b.east && lat <= b.north && lat > b.south;
}

function lineGeometry(lines: Position[][]): Geometry | null {
  if (lines.length === 0) return null;
  return lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines };
}

function polygonGeometry(polygons: Position[][][]): Geometry | null {
  if (polygons.length === 0) return null;
  return polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
}

/**
 * Liang-Barsky clipping of each segment. A line that leaves and re-enters
 * the tile becomes several pieces. Cut points are written with the exact
 * edge value on the clipped axis, so the neighbour tile's cut of the same
 * segment lands on the very same coordinates.
 */
export function clipLine(line: Position[], b: LngLatBounds): Position[][] {
  const pieces: Position[][] = [];
  let current: Position[] = [];
  const flush = () => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };

  for (let i = 0; i < line.length - 1; i++) {
    const clipped = clipSegment(line[i], line[i + 1], b);
    if (!clipped || liesOnExclusiveEdge(clipped[0], clipped[1], b)) {
      flush();
      continue;
    }
    const [start, end, enteredInside] = clipped;
    if (current.length === 0 || !enteredInside) {
      flush();
      current.push(start);
    }
    current.push(end);
    if (!samePosition(end, line[i + 1])) flush();
  }
  flush();
  return pieces;
}

/**
 * A segment running exactly along a shared edge would be kept by both
 * tiles. Only the tile on its east or south side keeps it.
 */
function liesOnExclusiveEdge(a: Position, c: Position, b: LngLatBounds): boolean {
  return (a[0] === b.east && c[0] === b.east) || (a[1] === b.south && c[1] === b.south);
}

/** [start, end, startIsTheOriginalVertex] of the part of ab inside the bounds, or null. */
function clipSegment(a: Position, c: Position, b: LngLatBounds): [Position, Position, boolean] | null {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  // Which edge (if any) produced each parameter, to snap the cut onto it.
  let edge0: Edge | null = null;
  let edge1: Edge | null = null;

  const tests: [p: number, q: number, edge: Edge][] = [
    [-dx, a[0] - b.west, "west"],
    [dx, b.east - a[0], "east"],
    [-dy, a[1] - b.south, "south"],
    [dy, b.north - a[1], "north"],
  ];
  for (const [p, q, edge] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) {
        t0 = r;
        edge0 = edge;
      }
    } else {
      if (r < t0) return null;
      if (r < t1) {
        t1 = r;
        edge1 = edge;
      }
    }
  }
  if (t0 >= t1) return null;
  const start = edge0 === null ? a : snapToEdge([a[0] + dx * t0, a[1] + dy * t0], edge0, b);
  const end = edge1 === null ? c : snapToEdge([a[0] + dx * t1, a[1] + dy * t1], edge1, b);
  return [start, end, edge0 === null];
}

type Edge = "west" | "east" | "south" | "north";

function snapToEdge(p: Position, edge: Edge, b: LngLatBounds): Position {
  return edge === "west" || edge === "east" ? [b[edge], p[1]] : [p[0], b[edge]];
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Polygons fully inside or outside skip the boolean operation: at z14 a tile
 * holds hundreds of building polygons and only the few on the edge need it.
 * Holes are kept, so a park with a pond stays correct.
 */
function clipPolygon(rings: Position[][], b: LngLatBounds): Position[][][] {
  const outer = rings[0];
  if (!outer || outer.length < 4) return [];
  const box = ringBox(outer);
  if (box.west >= b.west && box.east <= b.east && box.south >= b.south && box.north <= b.north) return [rings];
  if (box.west >= b.east || box.east <= b.west || box.south >= b.north || box.north <= b.south) return [];

  const result = intersect(featureCollection<Polygon>([turfPolygon(rings), turfPolygon([boundsRing(b)])]));
  if (!result) return [];
  return result.geometry.type === "Polygon" ? [result.geometry.coordinates] : result.geometry.coordinates;
}

function ringBox(ring: Position[]): LngLatBounds {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, east, south, north };
}

function boundsRing(b: LngLatBounds): Position[] {
  return [
    [b.west, b.south],
    [b.east, b.south],
    [b.east, b.north],
    [b.west, b.north],
    [b.west, b.south],
  ];
}
