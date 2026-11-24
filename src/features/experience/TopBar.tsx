import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { Wordmark } from "@/ui/Wordmark";

interface TopBarProps {
  /** Compact search, shown once the user is exploring. */
  search?: ReactNode;
  showSearch?: boolean;
  /** When set, the wordmark becomes a button back to the idle globe (no page reload). */
  onHome?: () => void;
}

/** Wordmark and, while exploring, the compact search to jump to another corner. */
export function TopBar({ search, showSearch = false, onHome }: TopBarProps) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] md:px-6 md:pt-5">
      {onHome ? (
        <button
          type="button"
          onClick={onHome}
          className="pointer-events-auto inline-flex min-h-11 items-center rounded-full pr-2 transition-opacity hover:opacity-80"
          aria-label="Inmobilite, volver al inicio"
        >
          <Wordmark compact={showSearch} />
        </button>
      ) : (
        <span className="inline-flex min-h-11 items-center pr-2">
          <Wordmark compact={showSearch} />
        </span>
      )}
      {search && (
        <div
          inert={!showSearch}
          className={cn(
            "topbar-search pointer-events-auto ml-auto w-full max-w-md md:ml-0 md:w-[22.5rem]",
            "md:absolute md:left-1/2 md:-translate-x-1/2",
            !showSearch && "topbar-search--hidden",
          )}
        >
          {search}
        </div>
      )}
    </header>
  );
}
