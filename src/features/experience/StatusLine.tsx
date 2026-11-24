import { GlassPanel } from "@/ui/GlassPanel";

/**
 * The only loading signal during the flight: one quiet line at the bottom,
 * never a spinner over the globe.
 */
export function StatusLine({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-20 flex justify-center">
      <GlassPanel
        role="status"
        aria-live="polite"
        className="animate-rise relative max-w-full overflow-hidden rounded-full px-5 py-3 text-sm text-text"
      >
        <span className="block truncate">
          {message}
          {detail && <span className="text-text-muted"> · {detail}</span>}
        </span>
        <span aria-hidden="true" className="status-track absolute inset-x-5 bottom-0 h-px overflow-hidden">
          <span className="status-sweep block h-full w-1/3 bg-accent" />
        </span>
      </GlassPanel>
    </div>
  );
}
