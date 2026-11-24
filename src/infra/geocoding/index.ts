import type { GeocodeResult } from "@/domain/types";
import { haversineMeters } from "@/domain/geo/projection";
import { georefProvider } from "./georef";
import { photonProvider } from "./photon";
import type { GeocodingProvider } from "./provider";
import { usigProvider } from "./usig";

/** Results closer than this are the same corner seen twice. */
export const DEDUPE_DISTANCE_M = 30;
/**
 * Same label this close is still the same place: Photon returns "Plaza de
 * Mayo" as the park, the subway station and two bus stops around it.
 */
export const SAME_LABEL_DEDUPE_DISTANCE_M = 250;

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
  /** True when every provider failed: the search is down, not empty. */
  allFailed: boolean;
}

export async function geocodeWithProviders(
  q: string,
  providers: readonly GeocodingProvider[],
  signal?: AbortSignal,
): Promise<GeocodeOutcome> {
  let failures = 0;
  for (const provider of providers) {
    signal?.throwIfAborted();
    try {
      const results = dedupeByDistance(await provider.search(q, signal));
      if (results.length > 0) return { results, degraded: failures > 0, allFailed: false };
    } catch (error) {
      if (signal?.aborted) throw error;
      failures++;
      console.warn(`[geocode] ${provider.name} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return { results: [], degraded: failures > 0, allFailed: providers.length > 0 && failures === providers.length };
}

export async function geocode(q: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  return (await geocodeWithProviders(q, DEFAULT_PROVIDERS, signal)).results;
}

/** Keeps the first (best ranked) of any results that point at the same place. */
export function dedupeByDistance(results: GeocodeResult[]): GeocodeResult[] {
  const kept: GeocodeResult[] = [];
  for (const r of results) {
    if (!kept.some((k) => isSamePlace(k, r))) kept.push(r);
  }
  return kept;
}

function isSamePlace(a: GeocodeResult, b: GeocodeResult): boolean {
  const meters = haversineMeters(a, b);
  if (meters < DEDUPE_DISTANCE_M) return true;
  return meters < SAME_LABEL_DEDUPE_DISTANCE_M && a.label.toLowerCase() === b.label.toLowerCase();
}
