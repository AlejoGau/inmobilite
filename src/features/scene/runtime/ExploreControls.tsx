"use client";

import { CameraControls } from "@react-three/drei";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Box3, Sphere, Vector3 } from "three";
import type { Building } from "@/domain/types";
import { useSceneRuntime } from "./SceneRuntime";

export const EXPLORE_LIMITS = {
  minDistance: 40,
  maxDistance: 420,
  minPolarAngle: 0.08,
  /** About 77° from vertical: low, cinematic views, but never under the ground. */
  maxPolarAngle: 1.35,
  /** The orbit target stays over the modelled area. */
  targetBoundsFactor: 0.55,
  smoothTime: 0.32,
  draggingSmoothTime: 0.12,
} as const;

export interface BuildingFocus {
  building: Building;
  centre: [number, number, number];
  radius: number;
}

export interface ExploreControlsProps {
  areaRadius: number;
  /** The selected building to frame, or null. */
  focus: BuildingFocus | null;
  /** Lower the DPR while moving (drei regress). Only on the high tier. */
  regress: boolean;
}

/**
 * Free orbit after the intro. Mounted only once the intro is over, and it
 * starts EXACTLY on the director's final pose, so the hand-over has no jump.
 */
export function ExploreControls({ areaRadius, focus, regress }: ExploreControlsProps) {
  const { director } = useSceneRuntime();
  const controls = useRef<CameraControls>(null);

  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { position, target } = director.sample(director.duration).camera;
    // No transition: the camera already sits here, this only syncs the controls' internal state.
    void c.setLookAt(position[0], position[1], position[2], target[0], target[1], target[2], false);
    const half = areaRadius * EXPLORE_LIMITS.targetBoundsFactor;
    c.setBoundary(new Box3(new Vector3(-half, 0, -half), new Vector3(half, 60, half)));
  }, [director, areaRadius]);

  useEffect(() => {
    const c = controls.current;
    if (!c || !focus) return;
    void c.fitToSphere(new Sphere(new Vector3(...focus.centre), Math.max(focus.radius * 1.15, 14)), true);
  }, [focus]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      regress={regress}
      minDistance={EXPLORE_LIMITS.minDistance}
      maxDistance={EXPLORE_LIMITS.maxDistance}
      minPolarAngle={EXPLORE_LIMITS.minPolarAngle}
      maxPolarAngle={EXPLORE_LIMITS.maxPolarAngle}
      smoothTime={EXPLORE_LIMITS.smoothTime}
      draggingSmoothTime={EXPLORE_LIMITS.draggingSmoothTime}
      dollyToCursor
      boundaryFriction={0.15}
    />
  );
}
