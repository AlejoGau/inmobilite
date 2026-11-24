"use client";

import { useId, useState, type ReactNode } from "react";
import type { AreaStats } from "@/domain/types";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { formatInteger } from "@/ui/format";
import { GlassPanel } from "@/ui/GlassPanel";
import { ChevronIcon, ReplayIcon, SearchIcon, TagIcon } from "@/ui/icons";
import { InfoTip } from "@/ui/InfoTip";
import { Switch } from "@/ui/Switch";
import { ATTRIBUTION, buildingsModelled, ESTIMATED_HEIGHTS_HELP, estimatedHeights } from "./copy";

const MAX_STREETS = 6;

interface InfoPanelProps {
  label: string;
  secondary?: string;
  stats: AreaStats;
  showLabels: boolean;
  onToggleLabels: () => void;
  onReplay: () => void;
  onNewSearch: () => void;
}

/** Left glass card on desktop; a collapsible bottom sheet on phones. */
export function InfoPanel({ label, secondary, stats, showLabels, onToggleLabels, onReplay, onNewSearch }: InfoPanelProps) {
  const titleId = useId();
  const detailsId = useId();
  // Phones start collapsed so the scene stays the hero; desktop ignores this.
  const [expanded, setExpanded] = useState(false);
  const streets = stats.streets.slice(0, MAX_STREETS);

  return (
    <GlassPanel
      as="aside"
      aria-labelledby={titleId}
      className={cn(
        "animate-rise absolute z-20 flex flex-col",
        "inset-x-0 bottom-0 max-h-[72dvh] rounded-b-none px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2",
        "md:inset-x-auto md:bottom-auto md:left-6 md:top-22 md:max-h-[calc(100dvh-7.5rem)] md:w-[22.5rem] md:rounded-b-panel md:p-6",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((e) => !e)}
        className="mx-auto -mb-1 flex min-h-11 w-full items-center justify-center gap-2 text-[0.8125rem] text-text-muted md:hidden"
      >
        <span aria-hidden="true" className="h-1 w-9 rounded-full bg-white/20" />
        <span className="sr-only">{expanded ? "Ocultar detalles" : "Ver detalles de la zona"}</span>
        <ChevronIcon size={16} className={cn("transition-transform duration-200", expanded && "rotate-180")} />
      </button>

      <header>
        <h2 id={titleId} className="font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.025em] text-text md:text-[1.625rem]">
          {label}
        </h2>
        {secondary && <p className="mt-1 text-sm text-text-muted">{secondary}</p>}
      </header>

      <div
        id={detailsId}
        className={cn("min-h-0 overflow-y-auto overscroll-contain md:overflow-visible", expanded ? "block" : "max-md:hidden")}
      >
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1">
          <Stat value={stats.buildings} label={buildingsModelled(stats.buildings)} />
          <Stat
            value={stats.estimatedHeights}
            label={estimatedHeights(stats.estimatedHeights)}
            help={<InfoTip label="Cómo se calculan las alturas" placement="bottom-end">{ESTIMATED_HEIGHTS_HELP}</InfoTip>}
          />
        </dl>

        {streets.length > 0 && (
          <section className="mt-6" aria-label="Calles de la zona">
            <h3 className="text-[0.8125rem] font-medium text-text-muted">Calles de la zona</h3>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {streets.map((street) => (
                <li key={street} className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[0.8125rem] text-text">
                  {street}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-6 text-xs leading-relaxed text-text-muted">{ATTRIBUTION}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 md:mt-6">
        <Button variant="primary" icon={<ReplayIcon size={18} />} onClick={onReplay}>
          Repetir recorrido
        </Button>
        <Switch checked={showLabels} onChange={onToggleLabels} label="Etiquetas" icon={<TagIcon size={18} className="text-text-muted" />} />
        <Button variant="ghost" icon={<SearchIcon size={18} />} onClick={onNewSearch} className="md:ml-auto">
          Nueva búsqueda
        </Button>
      </div>
    </GlassPanel>
  );
}

function Stat({ value, label, help }: { value: number; label: string; help?: ReactNode }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="flex items-center gap-1.5 text-[0.8125rem] leading-snug text-text-muted">
        {label}
        {help}
      </dt>
      <dd className="tabular font-display text-[2.25rem] font-semibold leading-none tracking-[-0.03em] text-text">
        {formatInteger(value)}
      </dd>
    </div>
  );
}
