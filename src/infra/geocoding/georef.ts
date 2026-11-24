import { z } from "zod";
import type { GeocodeResult } from "@/domain/types";
import { fetchJson } from "../http/fetchJson";
import { CABA_LABEL, formatStreetName, isCaba, joinIntersection, joinPlace } from "./format";
import { isValidLatLng, parseEach, PROVIDER_LIMIT, PROVIDER_TIMEOUT_MS, type GeocodingProvider } from "./provider";

/** Georef (datos.gob.ar): national street-level geocoder, covers the whole country. */
const GEOREF_URL = "https://apis.datos.gob.ar/georef/api/direcciones";

const namedRef = z.object({ nombre: z.string().nullish(), id: z.string().nullish() }).nullish();

const georefEntrySchema = z.object({
  calle: z.object({ nombre: z.string().min(1), categoria: z.string().nullish(), id: z.string().nullish() }),
  altura: z.object({ valor: z.number().nullish() }).nullish(),
  calle_cruce_1: namedRef,
  localidad_censal: namedRef,
  departamento: namedRef,
  provincia: namedRef,
  ubicacion: z.object({ lat: z.number().nullish(), lon: z.number().nullish() }).nullish(),
});

const georefResponseSchema = z.object({ direcciones: z.array(z.unknown()).default([]) });

export type GeorefResponse = z.infer<typeof georefResponseSchema>;
type GeorefEntry = z.infer<typeof georefEntrySchema>;

export function parseGeorefResponse(body: GeorefResponse): GeocodeResult[] {
  return parseEach(georefEntrySchema, body.direcciones)
    .map(toResult)
    .filter((r): r is GeocodeResult => r !== null);
}

function toResult(entry: GeorefEntry): GeocodeResult | null {
  const lat = entry.ubicacion?.lat;
  const lng = entry.ubicacion?.lon;
  if (lat == null || lng == null || !isValidLatLng(lat, lng)) return null;

  const height = entry.altura?.valor;
  const crossName = entry.calle_cruce_1?.nombre;
  // A bare street match is a random point on a same-named street anywhere in
  // the country ("plaza de mayo" lands in Chaco). Only a number or a corner
  // pins a real place; otherwise Photon (POIs) answers better.
  if (!height && !crossName) return null;

  const street = withAvenuePrefix(entry.calle.nombre, entry.calle.categoria);
  const label = crossName ? joinIntersection(street, formatStreetName(crossName)) : `${street} ${height}`;
  const province = entry.provincia?.nombre;
  const secondary = isCaba(province)
    ? CABA_LABEL
    : joinPlace([entry.localidad_censal?.nombre, province]);

  const result: GeocodeResult = {
    id: `georef:${entry.calle.id ?? entry.calle.nombre}:${height ?? crossName}`,
    label,
    lat,
    lng,
    kind: crossName ? "intersection" : "address",
    provider: "georef",
  };
  if (secondary) result.secondary = secondary;
  return result;
}

/** Georef keeps the street type in a separate field ("AV"), not in the name. */
function withAvenuePrefix(name: string, category: string | null | undefined): string {
  const formatted = formatStreetName(name);
  const isAvenue = category ? /^av/i.test(category) : false;
  return isAvenue && !formatted.startsWith("Av.") ? `Av. ${formatted}` : formatted;
}

export const georefProvider: GeocodingProvider = {
  name: "georef",
  async search(q, signal) {
    const url = `${GEOREF_URL}?${new URLSearchParams({ direccion: q, max: String(PROVIDER_LIMIT) })}`;
    const body = await fetchJson(url, georefResponseSchema, { timeoutMs: PROVIDER_TIMEOUT_MS, signal });
    return parseGeorefResponse(body);
  },
};
