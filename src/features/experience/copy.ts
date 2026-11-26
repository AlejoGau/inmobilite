import type { BuildingUse } from "@/domain/types";
import { MAX_BUILDINGS } from "@/domain/types";
import { plural } from "@/ui/format";

/** UI copy that depends on data, kept in one place so wording stays consistent. */

export const BUILDING_USE_LABELS: Record<BuildingUse, string> = {
  residential: "Residencial",
  commercial: "Comercial",
  civic: "Institucional",
  other: "Otro",
};

export const GEOCODING_CREDIT = "Geocoding USIG/Georef/Photon";

/** The area's data credits (they change with the sources that built it) plus the geocoders'. */
export function credits(areaAttribution: string): string {
  return areaAttribution ? `${areaAttribution} · ${GEOCODING_CREDIT}` : GEOCODING_CREDIT;
}

export const ESTIMATED_HEIGHTS_HELP =
  "Si OpenStreetMap trae la cantidad de pisos o la altura, usamos ese dato. Si no, la estimamos a partir del uso y la superficie del edificio.";

export const MEASURED_HEIGHTS_HELP =
  "Los volúmenes salen del modelo 3D de la ciudad del Gobierno de Buenos Aires (Tejido Urbano): cada altura está medida, no estimada.";

export function flyingStatus(label: string): string {
  return `Volando a ${label}…`;
}

export const MODELLING_STATUS = `Modelando hasta ${MAX_BUILDINGS} edificios…`;

/** Shown during the flight when the area arrived before the camera did. */
export function buildingsReady(count: number): string {
  return `${count} ${plural(count, "edificio listo", "edificios listos")}`;
}

export function buildingsModelled(count: number): string {
  return plural(count, "edificio cercano modelado", "edificios cercanos modelados");
}

export function estimatedHeights(count: number): string {
  return plural(count, "altura estimada", "alturas estimadas");
}

export function measuredHeights(count: number): string {
  return plural(count, "altura medida", "alturas medidas");
}
