import type { Destination } from "./experienceMachine";

/** Anything with URLSearchParams' `get`, so Next's ReadonlyURLSearchParams fits too. */
interface ParamReader {
  get(name: string): string | null;
}

const FALLBACK_LABEL = "Ubicación compartida";

/** Reads `?lat=..&lng=..&q=..`. Returns null unless both coordinates are valid. */
export function parseDeepLink(params: ParamReader): Destination | null {
  const lat = parseCoordinate(params.get("lat"), 90);
  const lng = parseCoordinate(params.get("lng"), 180);
  if (lat === null || lng === null) return null;
  const label = params.get("q")?.trim().slice(0, 120) || FALLBACK_LABEL;
  return { label, lat, lng };
}

/** The query string (with its leading "?") that `parseDeepLink` reads back. */
export function buildDeepLinkSearch(destination: Destination): string {
  const params = new URLSearchParams({
    lat: destination.lat.toFixed(6),
    lng: destination.lng.toFixed(6),
    q: destination.label,
  });
  return `?${params.toString()}`;
}

function parseCoordinate(raw: string | null, limit: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value;
}
