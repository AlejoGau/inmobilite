"use client";

import { useEffect, useState } from "react";
import type { GeocodeResult } from "@/domain/types";
import { fetchGeocode, isAbortError, MIN_QUERY_LENGTH } from "./geocodeClient";

export const SEARCH_DEBOUNCE_MS = 250;

export type SearchStatus = "idle" | "loading" | "ready" | "error";

export interface GeocodeSearch {
  status: SearchStatus;
  results: GeocodeResult[];
}

interface Settled extends GeocodeSearch {
  /** Which query and attempt this answer belongs to. */
  key: string;
}

const IDLE: GeocodeSearch = { status: "idle", results: [] };
const LOADING: GeocodeSearch = { status: "loading", results: [] };

/**
 * Debounced autocomplete. Each new query aborts the previous request, so a slow
 * answer for "acoy" can never overwrite the one for "acoyte y riva".
 *
 * The settled answer is stored with the key it answers; anything newer is
 * reported as "loading" during render, so no state is reset synchronously.
 * Bump `attempt` to retry the same query after an error.
 */
export function useGeocodeSearch(rawQuery: string, attempt = 0): GeocodeSearch {
  const query = rawQuery.trim();
  const key = `${attempt}:${query}`;
  const [settled, setSettled] = useState<Settled | null>(null);
  const searchable = query.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchGeocode(query, controller.signal)
        .then((results) => setSettled({ key, status: "ready", results }))
        .catch((error: unknown) => {
          if (!isAbortError(error)) setSettled({ key, status: "error", results: [] });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, query, searchable]);

  if (!searchable) return IDLE;
  if (settled?.key !== key) return LOADING;
  return settled;
}
