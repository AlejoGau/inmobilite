import type { GeocodeResult } from "@/domain/types";
import { haversineMeters } from "@/domain/geo/projection";
import { georefProvider } from "./georef";
import { photonProvider } from "./photon";
import type { GeocodingProvider } from "./provider";
import { usigProvider } from "./usig";

/** Results closer than this are the same corner seen twice. */
export const DEDUPE_DISTANCE_M = 30;

/**
 * Most specific first: USIG knows CABA corners, Georef the rest of the
 * country, Photon the world (and places by name). The first provider that
 * answers with something wins.
 */
export const DEFAULT_PROVIDERS: readonly GeocodingProvider[] = [usigProvider, georefProvider, photonProvider];

export interface GeocodeOutcome {
  results: GeocodeResult[];
  /** True when some provider failed, so an empty answer may not be the real one (do not cache it). */
  degraded: boolean;
}

export async function geocodeWithProviders(
  q: string,
  providers: readonly GeocodingProvider[],
  signal?: AbortSignal,
): Promise<GeocodeOutcome> {
  let degraded = false;
  for (const provider of providers) {
    signal?.throwIfAborted();
    try {
      const results = dedupeByDistance(await provider.search(q, signal));
      if (results.length > 0) return { results, degraded };
    } catch (error) {
      if (signal?.aborted) throw error;
      degraded = true;
      console.warn(`[geocode] ${provider.name} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return { results: [], degraded };
}

export async function geocode(q: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  return (await geocodeWithProviders(q, DEFAULT_PROVIDERS, signal)).results;
}

/** Keeps the first (best ranked) of any results within DEDUPE_DISTANCE_M of each other. */
export function dedupeByDistance(results: GeocodeResult[]): GeocodeResult[] {
  const kept: GeocodeResult[] = [];
  for (const r of results) {
    if (!kept.some((k) => haversineMeters(k, r) < DEDUPE_DISTANCE_M)) kept.push(r);
  }
  return kept;
}
