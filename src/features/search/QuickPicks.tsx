"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { GeocodeResult } from "@/domain/types";
import { cn } from "@/ui/cn";
import { fetchGeocode, isAbortError } from "./geocodeClient";
import { QUICK_PICKS } from "./quickPickOptions";

export interface QuickPicksHandle {
  /** Drops the chip request in flight: the user chose something else. */
  cancel(): void;
}

interface QuickPicksProps {
  ref?: Ref<QuickPicksHandle>;
  onStart: () => void;
  onPick: (result: GeocodeResult) => void;
  /** No confident match: hand the text to the search box so the user can choose. */
  onUnresolved: (text: string) => void;
  className?: string;
}

export function QuickPicks({ ref, onStart, onPick, onUnresolved, className }: QuickPicksProps) {
  const [pending, setPending] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  useImperativeHandle(
    ref,
    () => ({
      cancel() {
        controller.current?.abort();
        controller.current = null;
        setPending(null);
      },
    }),
    [],
  );

  async function resolve(query: string) {
    onStart();
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPending(query);
    try {
      const [first] = await fetchGeocode(query, current.signal);
      // Superseded while in flight (another chip, or a pick from the list): a late answer must not win.
      if (controller.current !== current) return;
      if (first) onPick(first);
      else onUnresolved(query);
    } catch (error) {
      if (controller.current === current && !isAbortError(error)) onUnresolved(query);
    } finally {
      if (controller.current === current) setPending(null);
    }
  }

  return (
    <ul className={cn("flex flex-wrap items-center justify-center gap-2", className)} aria-label="Esquinas para probar">
      {QUICK_PICKS.map(({ label, query }) => (
        <li key={query}>
          <button
            type="button"
            aria-busy={pending === query}
            disabled={pending !== null && pending !== query}
            onClick={() => resolve(query)}
            className={cn(
              "glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm text-text",
              "transition-[background-color,transform,opacity] duration-150 hover:bg-white/[0.08] active:scale-[0.97]",
              "disabled:opacity-50",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("size-1.5 rounded-full bg-accent", pending === query && "search-pulse")}
            />
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}
