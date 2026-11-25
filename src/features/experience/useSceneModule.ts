"use client";

import { useEffect, useState } from "react";
import type { AreaModel } from "@/domain/types";
import { loadSceneModule, type SceneModule } from "./stageLoader";

export type SceneLoad =
  | { status: "loading" }
  | { status: "ready"; scene: SceneModule }
  | { status: "failed"; error: unknown };

const LOADING: SceneLoad = { status: "loading" };

interface Failure {
  area: AreaModel;
  attempt: number;
  error: unknown;
}

/**
 * The 3D chunk, loaded the first time there is an area to show; once loaded it
 * stays loaded. A failure is reported only for the area and attempt it belongs
 * to, so a retry (a new `attempt`) or a new search downloads it again instead of
 * repeating a stale error. stageLoader forgets a failed import, so that second
 * call really fetches again (next/dynamic's React.lazy would keep the rejection).
 */
export function useSceneModule(area: AreaModel | null, attempt: number): SceneLoad {
  const [scene, setScene] = useState<SceneModule | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    if (!area || scene) return;
    let current = true;
    loadSceneModule().then(setScene, (error: unknown) => {
      if (current) setFailure({ area, attempt, error });
    });
    return () => {
      current = false;
    };
  }, [area, attempt, scene]);

  if (scene) return { status: "ready", scene };
  if (failure && failure.area === area && failure.attempt === attempt) return { status: "failed", error: failure.error };
  return LOADING;
}
