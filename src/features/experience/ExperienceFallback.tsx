import { SearchIcon } from "@/ui/icons";
import { Hero } from "./Hero";
import { TopBar } from "./TopBar";

/**
 * The prerendered first screen, shown until the client reads the URL.
 * Same headline and geometry as the live hero, so hydration causes no shift.
 */
export function ExperienceFallback() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ground text-text">
      <TopBar />
      <Hero
        search={
          <div aria-hidden="true" className="glass-strong flex h-15 items-center gap-3 rounded-full px-5 text-left text-[1.0625rem] text-text-muted">
            <SearchIcon size={20} />
            Probá: acoyte y riva
          </div>
        }
      />
    </main>
  );
}
