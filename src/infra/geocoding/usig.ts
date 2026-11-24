import { z } from "zod";
import type { GeocodeKind, GeocodeResult } from "@/domain/types";
import { fetchJson } from "../http/fetchJson";
import { CABA_LABEL, formatStreetName, isCaba, joinIntersection, joinPlace } from "./format";
import { isValidLatLng, parseEach, PROVIDER_LIMIT, PROVIDER_TIMEOUT_MS, type GeocodingProvider } from "./provider";

/**
 * USIG (Gobierno de la Ciudad) normaliser. It is the only free geocoder that
 * resolves partial CABA input like "acoyte y riva" into the exact corner.
 */
const USIG_URL = "https://servicios.usig.buenosaires.gob.ar/normalizar/";

/** USIG sends coordinates as strings for CABA and as numbers for the conurbano. */
const coordinate = z.union([z.number(), z.string().trim().min(1)]).transform(Number);

const usigEntrySchema = z.object({
  tipo: z.string(),
  direccion: z.string().optional(),
  nombre_calle: z.string().min(1),
  nombre_calle_cruce: z.string().nullish(),
  altura: z.number().nullish(),
  cod_calle: z.union([z.number(), z.string()]).nullish(),
  cod_calle_cruce: z.union([z.number(), z.string()]).nullish(),
  cod_partido: z.string().nullish(),
  nombre_localidad: z.string().nullish(),
  nombre_partido: z.string().nullish(),
  coordenadas: z.object({ x: coordinate, y: coordinate }).nullish(),
});

const usigResponseSchema = z.object({
  direccionesNormalizadas: z.array(z.unknown()).default([]),
  errorMessage: z.string().optional(),
});

export type UsigResponse = z.infer<typeof usigResponseSchema>;
type UsigEntry = z.infer<typeof usigEntrySchema>;

const KIND_BY_TIPO: Record<string, GeocodeKind> = {
  calle_y_calle: "intersection",
  calle_altura: "address",
  calle: "street",
};

export function parseUsigResponse(body: UsigResponse): GeocodeResult[] {
  return parseEach(usigEntrySchema, body.direccionesNormalizadas)
    .map(toResult)
    .filter((r): r is GeocodeResult => r !== null);
}

function toResult(entry: UsigEntry): GeocodeResult | null {
  // Bare street matches carry no coordinates: nothing to fly to.
  if (!entry.coordenadas) return null;
  const lng = entry.coordenadas.x;
  const lat = entry.coordenadas.y;
  if (!isValidLatLng(lat, lng)) return null;

  const kind = KIND_BY_TIPO[entry.tipo] ?? "place";
  const street = formatStreetName(entry.nombre_calle);
  const cross = entry.nombre_calle_cruce ? formatStreetName(entry.nombre_calle_cruce) : "";
  const label =
    kind === "intersection" && cross
      ? joinIntersection(street, cross)
      : kind === "address" && entry.altura
        ? `${street} ${entry.altura}`
        : street;

  // USIG gives no barrio for CABA, only the city.
  const secondary = isCaba(entry.cod_partido) || isCaba(entry.nombre_partido)
    ? CABA_LABEL
    : joinPlace([entry.nombre_localidad, entry.nombre_partido]);

  const idParts = [entry.cod_partido ?? "", entry.cod_calle ?? "", entry.cod_calle_cruce ?? entry.altura ?? ""];
  const result: GeocodeResult = { id: `usig:${idParts.join(":")}`, label, lat, lng, kind, provider: "usig" };
  if (secondary) result.secondary = secondary;
  return result;
}

export const usigProvider: GeocodingProvider = {
  name: "usig",
  async search(q, signal) {
    const url = `${USIG_URL}?${new URLSearchParams({ direccion: q, geocodificar: "true", maxOptions: String(PROVIDER_LIMIT) })}`;
    const body = await fetchJson(url, usigResponseSchema, { timeoutMs: PROVIDER_TIMEOUT_MS, signal });
    return parseUsigResponse(body).slice(0, PROVIDER_LIMIT);
  },
};
