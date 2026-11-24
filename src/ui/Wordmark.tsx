import { cn } from "./cn";

/**
 * The mark is a corner block seen from above at an angle: two street edges
 * meeting and one extruded volume in the accent, the product in one glyph.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <path d="M16 3 28 10v12l-12 7-12-7V10Z" fill="#14B8A6" opacity="0.18" />
      <path d="M16 9.5 22.5 13v7.5L16 24l-6.5-3.5V13Z" fill="#14B8A6" />
      <path d="M16 9.5 22.5 13 16 16.5 9.5 13Z" fill="#5EEAD4" />
    </svg>
  );
}

export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-text", className)}>
      <BrandMark />
      <span className={cn("font-display text-[1.0625rem] font-semibold tracking-[-0.02em]", compact && "max-sm:sr-only")}>
        Inmobilite
      </span>
    </span>
  );
}
