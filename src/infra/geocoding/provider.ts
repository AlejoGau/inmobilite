import type { z } from "zod";
import type { GeocodeResult } from "@/domain/types";

/** Per-provider timeout. A slow provider must not hold the whole search. */
export const PROVIDER_TIMEOUT_MS = 6000;
/** Results per provider; the UI lists a handful. */
export const PROVIDER_LIMIT = 5;

export interface GeocodingProvider {
  readonly name: GeocodeResult["provider"];
  search(q: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
}

/**
 * Validates list items one by one, so a single odd entry (a provider adding
 * a new result type) is dropped instead of failing the whole search.
 */
export function parseEach<S extends z.ZodType>(schema: S, items: unknown[]): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);
}
