import { createProjection } from "../geo/projection";
import { DEFAULT_AREA_RADIUS } from "../osm/overpass";
import type { AreaModel, LngLat } from "../types";
import { OSM_ATTRIBUTION } from "./buildArea";
import { composeArea } from "./composeArea";
import { buildingsFromTejido, type TejidoPiece } from "./gcbaBuildings";
import { EMPTY_COMPLEMENT, type OverpassComplement } from "./overpassComplement";
import { contextFromTiles, type VectorFeature } from "./tileContext";

export const OPENFREEMAP_CREDIT = "OpenFreeMap";
/** CC BY 2.5 AR requires the credit wherever the volumes are shown. */
export const GCBA_ATTRIBUTION = "Volumetría: Tejido Urbano, GCBA (CC BY 2.5 AR)";

export interface TileSources {
  /** OpenFreeMap features, each clipped to its tile. */
  features: readonly VectorFeature[];
  /** GCBA tejido pieces, or null when unavailable (outside CABA, or the service failed). */
  tejido: readonly TejidoPiece[] | null;
  /** What the optional Overpass call added, if it answered in time. */
  complement?: OverpassComplement;
}

/**
 * The tile pipeline: streets, parks and POIs from OpenFreeMap; buildings from
 * the GCBA 3D model when it has any here, else the tiles' own footprints;
 * trees and building names from Overpass when it answered. The live handler
 * and the offline fixture both run it, so the fixture shows exactly what
 * live data would.
 */
export function areaFromTiles(origin: LngLat, sources: TileSources, radius: number = DEFAULT_AREA_RADIUS): AreaModel {
  const projection = createProjection(origin);
  const context = contextFromTiles([...sources.features], projection, radius);
  const gcba = sources.tejido ? buildingsFromTejido(sources.tejido, projection, origin) : [];
  const complement = sources.complement ?? EMPTY_COMPLEMENT;
  const attributions = [OSM_ATTRIBUTION, OPENFREEMAP_CREDIT];
  if (gcba.length > 0) attributions.push(GCBA_ATTRIBUTION);

  return composeArea({
    origin,
    radius,
    roads: context.roads,
    sidewalkIds: context.sidewalkIds,
    parks: context.parks,
    mappedTrees: complement.mappedTrees,
    candidates: gcba.length > 0 ? gcba : context.fallbackBuildings,
    pois: [...complement.buildingPois, ...context.pois],
    attributions,
  });
}
