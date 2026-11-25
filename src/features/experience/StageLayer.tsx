"use client";

import { useState } from "react";
import type { AreaModel, Building } from "@/domain/types";
import type { CityStageProps } from "@/features/scene";
import { cn } from "@/ui/cn";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { StageFallback } from "./StageFallback";
import { useSceneModule, type SceneLoad } from "./useSceneModule";

interface StageLayerProps {
  /** The area to show while visible; null between searches. */
  area: AreaModel | null;
  visible: boolean;
  playId: number;
  showLabels: boolean;
  selectedBuildingId: string | null;
  onSelectBuilding: (building: Building | null) => void;
  onIntroEnd: () => void;
  skipIntro: boolean;
}

/**
 * The 3D stage over the map, with the ~700 ms crossfade both ways.
 *
 * It fades in with CSS `@starting-style` on mount, so it mounts only once the
 * 3D chunk has loaded (or failed): a fade on an empty layer would end in a hard
 * cut when the canvas arrived. On hide it keeps the last area on screen until
 * the fade-out ends, then unmounts the canvas to free the GPU while the globe flies.
 *
 * A failing stage (no WebGL2, a chunk that does not download, any crash while
 * rendering the scene) stays inside this layer: the globe, the chrome and the
 * search keep working around a fallback that can retry.
 */
export function StageLayer({ area, visible, playId, onIntroEnd, ...stageProps }: StageLayerProps) {
  const [shownArea, setShownArea] = useState<AreaModel | null>(visible ? area : null);
  // Bumped by "Reintentar": downloads the chunk again if that failed, and remounts the scene.
  const [attempt, setAttempt] = useState(0);
  const load = useSceneModule(shownArea, attempt);

  // Derived during render (React's documented pattern), not in an effect: a new
  // area replaces the shown one only while visible, so a fade-out never swaps content.
  if (visible && area && area !== shownArea) setShownArea(area);
  // Hidden before the chunk arrived: nothing reached the screen, so there is no fade-out to wait for.
  if (!visible && shownArea && load.status === "loading") setShownArea(null);

  if (!shownArea || load.status === "loading") return null;

  return (
    <div
      className={cn("stage-layer absolute inset-0 z-10", !visible && "stage-layer--hidden")}
      data-visible={visible}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && !visible) setShownArea(null);
      }}
      onTransitionCancel={(e) => {
        if (e.target === e.currentTarget && !visible) setShownArea(null);
      }}
      inert={!visible}
    >
      <ErrorBoundary
        key={attempt}
        fallback={<StageFallback playId={playId} onIntroEnd={onIntroEnd} onRetry={() => setAttempt((n) => n + 1)} />}
      >
        <SceneStage
          load={load}
          area={shownArea}
          playId={playId}
          onIntroEnd={onIntroEnd}
          className="h-full w-full"
          {...stageProps}
        />
      </ErrorBoundary>
    </div>
  );
}

type SettledSceneLoad = Exclude<SceneLoad, { status: "loading" }>;

/** Rethrows a failed download, so it gets the same fallback and retry as a crash while rendering. */
function SceneStage({ load, ...props }: CityStageProps & { load: SettledSceneLoad }) {
  if (load.status === "failed") throw load.error;
  const { CityStage } = load.scene;
  return <CityStage {...props} />;
}
