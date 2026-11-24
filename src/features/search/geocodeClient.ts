import type { GeocodeKind, GeocodeResponse, GeocodeResult } from "@/domain/types";

/** Below this length the API answers 400, so the UI does not ask. */
export const MIN_QUERY_LENGTH = 3;

const KINDS: ReadonlySet<GeocodeKind> = new Set(["intersection", "address", "street", "place"]);

export class GeocodeError extends Error {
  override name = "GeocodeError";
}

/** GET /api/geocode. Throws `GeocodeError` on HTTP or shape errors; rethrows aborts as-is. */
export async function fetchGeocode(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new GeocodeError(`El buscador respondió ${response.status}`);
  const body: unknown = await response.json();
  if (!isGeocodeResponse(body)) throw new GeocodeError("Respuesta inesperada del buscador");
  return body.results.filter(isGeocodeResult);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isGeocodeResponse(value: unknown): value is GeocodeResponse {
  return typeof value === "object" && value !== null && Array.isArray((value as { results?: unknown }).results);
}

// Our own API, but a malformed row must not crash the listbox: drop it instead.
function isGeocodeResult(value: unknown): value is GeocodeResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<GeocodeResult>;
  return (
    typeof r.id === "string" &&
    typeof r.label === "string" &&
    Number.isFinite(r.lat) &&
    Number.isFinite(r.lng) &&
    typeof r.kind === "string" &&
    KINDS.has(r.kind)
  );
}
