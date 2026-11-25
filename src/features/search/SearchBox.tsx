"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { GeocodeResult } from "@/domain/types";
import { cn } from "@/ui/cn";
import { CloseIcon, SearchIcon } from "@/ui/icons";
import { KindIcon, KIND_LABELS } from "./KindIcon";
import { QuickPicks, type QuickPicksHandle } from "./QuickPicks";
import { useGeocodeSearch } from "./useGeocodeSearch";
import { useSlashShortcut } from "./useSlashShortcut";

export interface SearchBoxProps {
  variant: "hero" | "compact";
  onPick: (result: GeocodeResult) => void;
  /** Fired once, on the first keystroke or quick pick. Used to prefetch the 3D chunk. */
  onFirstInput?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Whether "/" focuses this box. Only the box on screen should claim it. */
  shortcut?: boolean;
  className?: string;
}

/**
 * Address autocomplete following the ARIA 1.2 combobox pattern: focus stays in
 * the input and `aria-activedescendant` points at the highlighted option.
 */
export function SearchBox({
  variant,
  onPick,
  onFirstInput,
  placeholder = "Probá: acoyte y riva",
  autoFocus = false,
  shortcut = true,
  className,
}: SearchBoxProps) {
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const statusId = `${uid}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const quickPicks = useRef<QuickPicksHandle>(null);
  const announcedFirstInput = useRef(false);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The highlight belongs to one list of results; a new list starts unhighlighted.
  const [highlight, setHighlight] = useState<{ results: GeocodeResult[]; index: number } | null>(null);

  const search = useGeocodeSearch(query, attempt);
  const results = search.status === "ready" ? search.results : [];
  const activeIndex = highlight?.results === search.results ? highlight.index : -1;
  const expanded = open && search.status !== "idle";
  const activeId = expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  useSlashShortcut(inputRef, shortcut);

  function optionId(index: number) {
    return `${uid}-option-${index}`;
  }

  function notifyFirstInput() {
    if (announcedFirstInput.current) return;
    announcedFirstInput.current = true;
    onFirstInput?.();
  }

  function pick(result: GeocodeResult) {
    // The last choice wins: a chip answer still in flight must not override it.
    quickPicks.current?.cancel();
    setQuery("");
    setOpen(false);
    setHighlight(null);
    inputRef.current?.blur();
    onPick(result);
  }

  function moveHighlight(step: 1 | -1) {
    if (results.length === 0) return;
    const next = activeIndex < 0 ? (step === 1 ? 0 : results.length - 1) : (activeIndex + step + results.length) % results.length;
    setHighlight({ results: search.results, index: next });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        else moveHighlight(event.key === "ArrowDown" ? 1 : -1);
        break;
      case "Enter":
        if (expanded && results.length > 0) {
          event.preventDefault();
          pick(results[Math.max(activeIndex, 0)]);
        }
        break;
      case "Escape":
        // First Escape closes the list; a second one clears the text (APG behaviour).
        if (expanded) setOpen(false);
        else if (query) setQuery("");
        else inputRef.current?.blur();
        break;
    }
  }

  const hero = variant === "hero";

  return (
    <div className={cn("relative w-full", className)}>
      <div
        className={cn(
          "glass-strong flex items-center gap-1 rounded-full transition-shadow duration-200",
          "focus-within:ring-2 focus-within:ring-focus/70",
          hero ? "h-15 pl-5 pr-2" : "h-11 pl-3.5 pr-1",
        )}
      >
        <SearchIcon size={hero ? 20 : 18} className="shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={statusId}
          aria-keyshortcuts="/"
          aria-label="Buscar una esquina o dirección"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            notifyFirstInput();
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(
            "h-full min-w-0 flex-1 bg-transparent px-2 text-text outline-none placeholder:text-text-muted",
            // Focus is shown on the whole field (focus-within ring), not on the bare input.
            "focus-visible:outline-none",
            hero ? "text-[1.0625rem]" : "text-sm",
          )}
        />
        {query && (
          <button
            type="button"
            aria-label="Borrar búsqueda"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
          >
            <CloseIcon size={18} />
          </button>
        )}
      </div>

      <div
        className={cn(
          "glass-strong absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-3xl shadow-float",
          "origin-top transition-[opacity,transform] duration-150 ease-out",
          expanded ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0",
        )}
      >
        <ul id={listboxId} role="listbox" aria-label="Resultados" className="max-h-[min(22rem,50dvh)] overflow-y-auto p-1.5">
          {results.map((result, index) => (
            <li
              key={result.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              // Keep focus in the input so the combobox stays open while clicking.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => index !== activeIndex && setHighlight({ results: search.results, index })}
              onClick={() => pick(result)}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 transition-colors duration-100",
                index === activeIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.05]",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
                  index === activeIndex ? "bg-accent-soft text-accent-strong" : "bg-white/[0.06] text-text-muted",
                )}
              >
                <KindIcon kind={result.kind} />
                <span className="sr-only">{KIND_LABELS[result.kind]}: </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-medium text-text">{result.label}</span>
                {result.secondary && <span className="block truncate text-[0.8125rem] text-text-muted">{result.secondary}</span>}
              </span>
            </li>
          ))}
        </ul>
        <SearchState status={search.status} hasResults={results.length > 0} onRetry={() => setAttempt((a) => a + 1)} />
      </div>

      {/* Polite status for screen readers; the visual states live in the panel above. */}
      <p id={statusId} aria-live="polite" className="sr-only">
        {statusMessage(search.status, results.length)}
      </p>

      {hero && (
        <QuickPicks
          ref={quickPicks}
          className="mt-5"
          onStart={notifyFirstInput}
          onPick={pick}
          onUnresolved={(text) => {
            setQuery(text);
            setOpen(true);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function SearchState({ status, hasResults, onRetry }: { status: string; hasResults: boolean; onRetry: () => void }) {
  if (status === "loading") {
    return (
      <div className="flex min-h-14 items-center gap-3 px-4.5 text-sm text-text-muted">
        <span className="search-pulse size-1.5 rounded-full bg-accent" aria-hidden="true" />
        Buscando direcciones…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex min-h-14 items-center justify-between gap-3 px-4.5 py-2 text-sm text-text">
        <span>No pudimos buscar ahora. Revisá la conexión.</span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onRetry}
          className="min-h-11 shrink-0 rounded-full px-3 font-medium text-accent-strong transition-colors hover:bg-white/[0.06]"
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (status === "ready" && !hasResults) {
    return (
      <div className="px-4.5 py-4 text-sm leading-relaxed text-text-muted">
        <span className="block font-medium text-text">No encontramos esa dirección.</span>
        Probá con dos calles que se crucen, por ejemplo “cabildo y juramento”.
      </div>
    );
  }
  return null;
}

function statusMessage(status: string, count: number): string {
  if (status === "loading") return "Buscando…";
  if (status === "error") return "No se pudo buscar.";
  if (status === "ready") return count === 0 ? "Sin resultados." : `${count} ${count === 1 ? "resultado" : "resultados"}. Usá las flechas para elegir.`;
  return "";
}
