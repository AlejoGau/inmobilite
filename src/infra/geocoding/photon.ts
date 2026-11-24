import { z } from "zod";
import type { GeocodeKind, GeocodeResult } from "@/domain/types";
import { fetchJson } from "../http/fetchJson";
import { CABA_LABEL, isCaba, joinPlace } from "./format";
import { isValidLatLng, parseEach, PROVIDER_LIMIT, PROVIDER_TIMEOUT_MS, type GeocodingProvider } from "./provider";

/** Photon (komoot): global OSM geocoder, good at places ("plaza de mayo"). */
const PHOTON_URL = "https://photon.komoot.io/api/";
/** Results are biased towards Buenos Aires, where the demo lives. */
const BIAS = { lat: "-34.6", lon: "-58.44" };

const photonFeatureSchema = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }),
  properties: z.object({
    osm_type: z.string().nullish(),
    osm_id: z.number().nullish(),
    osm_key: z.string().nullish(),
    type: z.string().nullish(),
    name: z.string().nullish(),
    street: z.string().nullish(),
    housenumber: z.string().nullish(),
    locality: z.string().nullish(),
    district: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    country: z.string().nullish(),
  }),
});

const photonResponseSchema = z.object({ features: z.array(z.unknown()).default([]) });

export type PhotonResponse = z.infer<typeof photonResponseSchema>;
type PhotonFeature = z.infer<typeof photonFeatureSchema>;

export function parsePhotonResponse(body: PhotonResponse): GeocodeResult[] {
  return parseEach(photonFeatureSchema, body.features)
    .map(toResult)
    .filter((r): r is GeocodeResult => r !== null);
}

function toResult(feature: PhotonFeature): GeocodeResult | null {
  const [lng, lat] = feature.geometry.coordinates;
  if (!isValidLatLng(lat, lng)) return null;
  const p = feature.properties;

  const address = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : undefined;
  const label = p.name ?? address;
  if (!label) return null;

  const city = isCaba(p.state) ? CABA_LABEL : p.city ?? p.state;
  const secondary = joinPlace([p.district ?? p.locality, city, isCaba(p.state) ? undefined : p.country]);

  const result: GeocodeResult = {
    id: `photon:${p.osm_type ?? "X"}${p.osm_id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}`,
    label,
    lat,
    lng,
    kind: kindOf(p),
    provider: "photon",
  };
  if (secondary) result.secondary = secondary;
  return result;
}

function kindOf(p: PhotonFeature["properties"]): GeocodeKind {
  if (p.type === "street") return "street";
  if (p.type === "house" && p.housenumber && !p.name) return "address";
  return "place";
}

export const photonProvider: GeocodingProvider = {
  name: "photon",
  async search(q, signal) {
    const params = new URLSearchParams({ q, limit: String(PROVIDER_LIMIT), ...BIAS });
    const body = await fetchJson(`${PHOTON_URL}?${params}`, photonResponseSchema, {
      timeoutMs: PROVIDER_TIMEOUT_MS,
      signal,
    });
    return parsePhotonResponse(body);
  },
};
