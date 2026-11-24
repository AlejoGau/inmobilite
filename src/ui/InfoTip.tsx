"use client";

import { useId, useState } from "react";
import { cn } from "./cn";
import { InfoIcon } from "./icons";

interface InfoTipProps {
  /** Accessible name of the trigger, e.g. "Qué significa". */
  label: string;
  children: string;
  /** Where the bubble opens. "bottom-end" stays inside scroll containers and narrow sheets. */
  placement?: "top" | "bottom-end";
  className?: string;
}

const PLACEMENTS = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  "bottom-end": "top-full right-0 mt-2",
} as const;

/**
 * A small explanatory tooltip. It opens on hover and focus for pointer and
 * keyboard users, and toggles on tap, since touch screens have no hover.
 */
export function InfoTip({ label, children, placement = "top", className }: InfoTipProps) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setHovered(true)}
        onBlur={() => {
          setHovered(false);
          setPinned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setHovered(false);
            setPinned(false);
          }
        }}
        // The visible glyph is small; the padding keeps the hit area at 44px.
        className="-m-3 inline-flex size-11 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text"
      >
        <InfoIcon size={16} />
      </button>
      <span
        id={id}
        role="tooltip"
        className={cn(
          "glass-strong pointer-events-none absolute z-30 w-64 max-w-[calc(100vw-3rem)] rounded-xl px-3.5 py-2.5",
          PLACEMENTS[placement],
          "text-[0.8125rem] leading-snug text-text shadow-float transition-[opacity,transform] duration-150",
          open ? "opacity-100" : "opacity-0",
        )}
      >
        {children}
      </span>
    </span>
  );
}
