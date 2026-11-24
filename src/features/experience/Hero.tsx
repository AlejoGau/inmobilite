import type { ReactNode } from "react";
import { MAX_BUILDINGS } from "@/domain/types";
import { cn } from "@/ui/cn";

interface HeroProps {
  /** The search control. The prerendered shell passes a static stand-in. */
  search: ReactNode;
  visible?: boolean;
}

/**
 * The idle first screen: what this is and the one thing to do. Presentational
 * and hook-free, so the prerendered fallback and the live app share it.
 */
export function Hero({ search, visible = true }: HeroProps) {
  return (
    <section
      aria-labelledby="hero-title"
      inert={!visible}
      className={cn(
        "hero absolute inset-x-0 top-[max(6.5rem,15dvh)] z-20 mx-auto flex w-full max-w-2xl flex-col items-center px-4 text-center",
        !visible && "hero--hidden",
      )}
    >
      <h1
        id="hero-title"
        className="font-display text-[clamp(2.75rem,8vw,5.25rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-text"
      >
        Tu esquina, en 3D
      </h1>
      <p className="mt-5 max-w-[34rem] text-[1.0625rem] leading-relaxed text-text-muted sm:text-lg">
        Escribí dos calles de Buenos Aires y volá hasta el cruce: calles, árboles y los {MAX_BUILDINGS} edificios más
        cercanos, con datos reales de OpenStreetMap.
      </p>
      <div className="mt-9 w-full max-w-xl">{search}</div>
    </section>
  );
}
