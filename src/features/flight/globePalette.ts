import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * OpenFreeMap's "dark" style paints land rgb(12,12,12) and water rgb(27,27,29),
 * so at globe zoom the continents disappear into a black disc. These overrides
 * switch to the app's blue-slate palette, the same family as the 3D scene
 * background: the globe reads at a glance and the map-to-scene crossfade does
 * not jump in colour.
 *
 * A layer that a future version of the style drops is skipped, not an error.
 */
type PaintProperty = Parameters<MapLibreMap["setPaintProperty"]>[1];

const PAINT_OVERRIDES: ReadonlyArray<readonly [layerId: string, property: PaintProperty, value: string]> = [
  ["background", "background-color", "#1b2332"],
  ["water", "fill-color", "#0b1018"],
  ["waterway", "line-color", "#0b1018"],
  ["landuse_residential", "fill-color", "#202a3b"],
  ["landcover_wood", "fill-color", "#1c2a2a"],
  ["landuse_park", "fill-color", "#1c2b28"],
  ["building", "fill-color", "#273143"],
  ["boundary_country_z0-4", "line-color", "rgba(148, 197, 214, 0.35)"],
  ["boundary_country_z5-", "line-color", "rgba(148, 197, 214, 0.35)"],
];

export function applyGlobePalette(map: MapLibreMap): void {
  for (const [layerId, property, value] of PAINT_OVERRIDES) {
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value);
  }
}
