"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { AreaModel, Building } from "@/domain/types";
import { cn } from "@/ui/cn";
import { loadSceneModule } from "./stageLoader";

const CityStage = dynamic(() => loadSceneModule().then((m) => m.CityStage), {
  ssr: false,
  loading: () => null,
});

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
 * It fades in with CSS `@starting-style` on mount, and on hide it keeps the
 * last area on screen until the fade-out ends, then unmounts the canvas to
 * free the GPU while the globe flies.
 */
export function StageLayer({ area, visible, ...stageProps }: StageLayerProps) {
  const [shownArea, setShownArea] = useState<AreaModel | null>(visible ? area : null);

  // Derived during render (React's documented pattern), not in an effect: a new
  // area replaces the shown one only while visible, so a fade-out never swaps content.
  if (visible && area && area !== shownArea) setShownArea(area);

  if (!shownArea) return null;

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
      <CityStage area={shownArea} className="h-full w-full" {...stageProps} />
    </div>
  );
}
