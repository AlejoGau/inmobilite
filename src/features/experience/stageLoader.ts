/**
 * One import() for the 3D chunk (three, R3F, postprocessing), shared by the
 * prefetch and by next/dynamic, so warming it on the first keystroke makes the
 * crossfade instant instead of waiting on a download after the flight.
 */

type SceneModule = typeof import("@/features/scene");

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
