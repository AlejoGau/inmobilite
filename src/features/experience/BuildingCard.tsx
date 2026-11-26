"use client";

import { useEffect, useId } from "react";
import type { Building, FacadePhoto } from "@/domain/types";
import { IconButton } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { formatInteger, formatMeters, formatMonthYear, formatSquareMeters } from "@/ui/format";
import { GlassPanel } from "@/ui/GlassPanel";
import { BuildingIcon, CloseIcon } from "@/ui/icons";
import { BUILDING_USE_LABELS } from "./copy";

interface BuildingCardProps {
  building: Building;
  onClose: () => void;
  /** It is the property the user searched for (the first featured building). */
  isSearchedProperty?: boolean;
}

/** Details of the building picked in the scene. Right card on desktop, bottom sheet on phones. */
export function BuildingCard({ building, onClose, isSearchedProperty = false }: BuildingCardProps) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const estimated = building.heightSource === "estimated";

  return (
    <GlassPanel
      as="aside"
      strong
      aria-labelledby={titleId}
      // Keyed by building so switching buildings replays the entrance.
      key={building.id}
      className={cn(
        "animate-rise absolute z-30 shadow-float",
        "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] p-5",
        "md:inset-x-auto md:bottom-auto md:right-6 md:top-22 md:w-80",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
          <BuildingIcon size={20} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id={titleId} className="font-display text-lg font-semibold leading-tight tracking-[-0.02em] text-text">
            {building.name ?? "Edificio"}
          </h2>
          {(isSearchedProperty || estimated) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {isSearchedProperty && (
                <span className="inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-strong">
                  Propiedad buscada
                </span>
              )}
              {estimated && (
                <span className="inline-flex rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-text-muted">
                  altura estimada
                </span>
              )}
            </div>
          )}
        </div>
        <IconButton label="Cerrar" icon={<CloseIcon size={18} />} onClick={onClose} className="-mr-2 -mt-2" />
      </div>

      {building.facade && <FacadeThumbnail facade={building.facade} />}

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
        <Fact label="Pisos" value={formatInteger(building.levels)} />
        <Fact label="Altura" value={formatMeters(building.height)} />
        <Fact label="Uso" value={BUILDING_USE_LABELS[building.use]} />
        <Fact label="Superficie en planta" value={formatSquareMeters(building.area)} />
      </dl>
    </GlassPanel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.8125rem] text-text-muted">{label}</dt>
      <dd className="tabular mt-0.5 text-[1.0625rem] font-medium text-text">{value}</dd>
    </div>
  );
}

/** The real photo the scene drapes on the front, with when it was taken and the credit the GCBA licence asks for. */
function FacadeThumbnail({ facade }: { facade: FacadePhoto }) {
  const taken = facade.date ? formatMonthYear(facade.date) : null;
  return (
    <figure className="mt-4">
      {/* A plain img on purpose: the photo comes straight from the GCBA, already small; next/image would proxy it for nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={facade.url}
        alt="Foto de la fachada desde la calle"
        width={550}
        height={411}
        loading="lazy"
        className="aspect-[4/3] max-h-36 w-full rounded-xl object-cover md:max-h-none"
      />
      <figcaption className="mt-1.5 text-xs leading-relaxed text-text-muted">
        {taken ? `Foto de ${taken}. ` : ""}
        {facade.credit}
      </figcaption>
    </figure>
  );
}
