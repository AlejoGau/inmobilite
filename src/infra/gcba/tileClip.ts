import type { Geometry } from "geojson";
import type { TileId } from "@/domain/geo/tiles";
import { boxOf, clipToBox, type Box, type PolygonCoordinates } from "@/domain/area/gcbaBuildings";

/**
 * MVT geometry carries a buffer beyond the tile edge, so a feature that
 * crosses an edge comes in two tiles and the two copies OVERLAP inside the
 * buffer. Overlapping coplanar volumes z-fight in the scene, so every
 * polygon is clipped to its own tile's exact bounds: the fragments then abut
 * along the edge and never overlap.
 */

/** The exact lng/lat bounds of an XYZ (Web Mercator) tile: x is the longitude, y the latitude. */
export function tileBounds(tile: TileId): Box {
  const n = 2 ** tile.z;
  const lng = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  // Row numbers grow southwards, so the tile's top row is its northern edge.
  return { minX: lng(tile.x), maxX: lng(tile.x + 1), minY: lat(tile.y + 1), maxY: lat(tile.y) };
}

/** The polygons of a Polygon or MultiPolygon geometry; nothing for other geometry types. */
export function polygonsOf(geometry: Geometry): PolygonCoordinates[] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/**
 * Clips a polygon to the bounds. Most features lie wholly inside their tile,
 * so those skip the (comparatively slow) boolean operation.
 */
export function clipPolygonToBounds(polygon: PolygonCoordinates, bounds: Box): PolygonCoordinates[] {
  const box = boxOf(polygon[0]);
  if (box.minX >= bounds.minX && box.maxX <= bounds.maxX && box.minY >= bounds.minY && box.maxY <= bounds.maxY) {
    return [polygon];
  }
  if (box.maxX <= bounds.minX || box.minX >= bounds.maxX || box.maxY <= bounds.minY || box.minY >= bounds.maxY) {
    return [];
  }
  return clipToBox(polygon, bounds);
}
