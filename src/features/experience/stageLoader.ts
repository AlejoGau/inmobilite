/**
 * One import() for the 3D chunk (three, R3F, postprocessing), shared by the
 * prefetch and by the stage (useSceneModule), so warming it on the first
 * keystroke makes the crossfade instant instead of waiting on a download after
 * the flight.
 */

import type { AreaModel } from "@/domain/types";

export type SceneModule = typeof import("@/features/scene");

let pending: Promise<SceneModule> | null = null;

export function loadSceneModule(): Promise<SceneModule> {
  pending ??= import("@/features/scene").catch((error: unknown) => {
    // Let a later call retry (a flaky network should not poison the session).
    pending = null;
    throw error;
  });
  return pending;
}

export function prefetchScene(): void {
  loadSceneModule().catch(() => {
    // Prefetch is best effort; the real load reports its own failure.
  });
}

/**
 * Runs the scene's heavy per-area preparation (the ground polygon booleans,
 * 100+ ms on a laptop) in idle time, usually while the map is still flying,
 * so mounting the stage does not stall the crossfade. Best effort.
 */
export function prewarmStage(area: AreaModel): void {
  loadSceneModule()
    .then((scene) => {
      const run = () => scene.prewarmCityStage(area);
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 1500 });
      else window.setTimeout(run, 0);
    })
    .catch(() => {
      // Without the warm-up the stage still mounts; it just does the work then.
    });
}
