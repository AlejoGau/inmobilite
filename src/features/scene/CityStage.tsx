"use client";

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from "react";
import type { AreaModel, Building } from "@/domain/types";
import { INTRO_START, startPose, orbitPosition } from "./director/cameraPose";
import { DPR_RANGE } from "./runtime/QualityController";
import { createStageInteraction } from "./runtime/stageInteraction";
import { SceneRoot } from "./SceneRoot";

export interface CityStageProps {
  area: AreaModel;
  /** Changing this number replays the intro from t=0. */
  playId: number;
  showLabels: boolean;
  /** Buildings the user selected (null = none). Controlled by the parent. */
  selectedBuildingId: string | null;
  onSelectBuilding: (building: Building | null) => void;
  /** Fired once each time the intro reaches its end. */
  onIntroEnd?: () => void;
  /** If true, skip straight to the end of the intro (reduced motion, deep links). */
  skipIntro?: boolean;
  className?: string;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** Stable small id per AreaModel object: a new area remounts the scene and rebuilds its geometry. */
const areaIds = new WeakMap<AreaModel, number>();
let nextAreaId = 1;
function areaId(area: AreaModel): number {
  let id = areaIds.get(area);
  if (id === undefined) {
    id = nextAreaId++;
    areaIds.set(area, id);
  }
  return id;
}

function describe(area: AreaModel): string {
  const [first, second] = area.stats.streets;
  const corner = first && second ? `de la esquina de ${first} y ${second}` : first ? `de ${first}` : "del lugar buscado";
  const count = area.buildings.length;
  const buildings = count === 1 ? "1 edificio" : `${count} edificios`;
  return `Maqueta 3D ${corner}, con ${buildings}, calles, parques y árboles.`;
}

/**
 * Depth range. The orbit never gets closer than 40 m to its target, so a 2 m
 * near plane is safe and keeps depth precision for the 2-17 cm layer gaps.
 */
const CAMERA_NEAR = 2;
const CAMERA_FAR = 3000;

/** Initial camera, before the first frame: the start of the intro. */
const INITIAL_CAMERA_POSITION = (() => {
  const pose = startPose();
  return orbitPosition(pose.bearingDeg, pose.polarDeg, pose.distance, pose.target);
})();

/**
 * The 3D corner: a cinematic intro that lands on a 3/4 hero view, then free
 * orbit. Fills its parent. Client only (WebGL): the app loads this module
 * lazily, in the browser only, through features/experience/stageLoader.ts
 * (useSceneModule), which also lets a failed chunk load be retried.
 */
export function CityStage({
  area,
  playId,
  showLabels,
  selectedBuildingId,
  onSelectBuilding,
  onIntroEnd,
  skipIntro = false,
  className,
}: CityStageProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const [interaction] = useState(createStageInteraction);
  const label = useMemo(() => describe(area), [area]);

  // The <canvas> itself is the image; the selection tag (drei Html) is a DOM
  // sibling, so it stays readable instead of being swallowed by role="img".
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", label);
  }, [label]);

  // Clicking empty ground (or sky) clears the selection.
  const handlePointerMissed = useCallback(() => {
    if (interaction.clickMaySelect()) onSelectBuilding(null);
  }, [interaction, onSelectBuilding]);

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%" }}
      // A press anywhere on the stage during the intro jumps to its end, and its click never selects.
      onPointerDown={interaction.pointerDown}
    >
      <Canvas
        ref={canvas}
        shadows="percentage"
        // The range on every tier, the low one included: see QualityController.
        dpr={DPR_RANGE}
        performance={{ min: 0.75 }}
        frameloop="always"
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
        camera={{ fov: INTRO_START.fovDeg, near: CAMERA_NEAR, far: CAMERA_FAR, position: INITIAL_CAMERA_POSITION }}
        onPointerMissed={handlePointerMissed}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <SceneRoot
          key={areaId(area)}
          area={area}
          playId={playId}
          showLabels={showLabels}
          selectedBuildingId={selectedBuildingId}
          onSelectBuilding={onSelectBuilding}
          onIntroEnd={onIntroEnd}
          skipIntro={skipIntro || reducedMotion}
          interaction={interaction}
        />
      </Canvas>
    </div>
  );
}
