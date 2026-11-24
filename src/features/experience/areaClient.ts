import type { AreaErrorResponse, AreaModel } from "@/domain/types";

const GENERIC_ERROR = "No pudimos traer los datos de esta zona.";

export class AreaRequestError extends Error {
  override name = "AreaRequestError";
}

/** GET /api/area. Throws `AreaRequestError` with a message fit for the UI; aborts propagate as-is. */
export async function fetchArea(lat: number, lng: number, signal?: AbortSignal): Promise<AreaModel> {
  const params = new URLSearchParams({ lat: lat.toFixed(6), lng: lng.toFixed(6) });
  let response: Response;
  try {
    response = await fetch(`/api/area?${params.toString()}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AreaRequestError("Sin conexión. Revisá tu red y probá de nuevo.");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AreaRequestError(readErrorMessage(body) ?? GENERIC_ERROR);
  if (!isAreaModel(body)) throw new AreaRequestError(GENERIC_ERROR);
  return body;
}

function readErrorMessage(body: unknown): string | null {
  const error = (body as Partial<AreaErrorResponse> | null)?.error;
  return typeof error === "string" && error.trim() ? error : null;
}

// A shallow check of what the shell itself reads; the scene validates its own needs.
function isAreaModel(value: unknown): value is AreaModel {
  if (typeof value !== "object" || value === null) return false;
  const area = value as Partial<AreaModel>;
  return (
    Array.isArray(area.buildings) &&
    Array.isArray(area.roads) &&
    typeof area.stats === "object" &&
    area.stats !== null &&
    Array.isArray(area.stats.streets)
  );
}
