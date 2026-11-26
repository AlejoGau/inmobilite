"use client";

import { CameraControls } from "@react-three/drei";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Box3, Sphere, Vector3 } from "three";
import type { AreaModel, Building } from "@/domain/types";
import { partCorners } from "../geometry/buildingExtent";
import { ringCentroid } from "../geometry/polygon2d";
import { useSceneRuntime } from "./SceneRuntime";

export const EXPLORE_LIMITS = {
  minDistance: 40,
  maxDistance: 420,
  minPolarAngle: 0.08,
  /** About 77° from vertical: low, cinematic views, but never under the ground. */
  maxPolarAngle: 1.35,
  /** The orbit target stays over the modelled area: the smallest half-size of its box, as a share of the radius. */
  targetBoundsFactor: 0.55,
  /** The lowest top of that box (m); a tall building raises it. */
  targetCeiling: 60,
  /** Room (m) the box keeps around every building's centre, so each one can be framed. */
  targetMargin: 5,
  smoothTime: 0.32,
  draggingSmoothTime: 0.12,
} as const;

export interface BuildingFocus {
  building: Building;
  centre: [number, number, number];
  radius: number;
}

/**
 * What the camera frames for a selected building: the middle of its volume
 * (half the tallest part's height), and a sphere around it holding every
 * corner of every part.
 */
export function focusFor(building: Building): BuildingFocus {
  const [x, north] = ringCentroid(building.footprint);
  const mid = building.height / 2;
  let radius = mid;
  for (const [px, py, height] of partCorners(building)) {
    const horizontal = Math.hypot(px - x, py - north);
    // The ground corner and the roof corner of this part; the farther one bounds it.
    radius = Math.max(radius, Math.hypot(horizontal, Math.max(mid, Math.abs(height - mid))));
  }
  return { building, centre: [x, mid, -north], radius };
}

/**
 * The box the orbit target stays in: the core of the area, grown so every
 * building's focus centre fits. fitToSphere clamps its target to this box,
 * and where OSM is sparse the 20 closest buildings reach past the core, so a
 * fixed box would frame its own edge instead of the selected building.
 */
export function exploreTargetBounds(area: AreaModel): Box3 {
  let half = area.radius * EXPLORE_LIMITS.targetBoundsFactor;
  let top: number = EXPLORE_LIMITS.targetCeiling;
  for (const building of area.buildings) {
    const [x, y, z] = focusFor(building).centre;
    half = Math.max(half, Math.abs(x) + EXPLORE_LIMITS.targetMargin, Math.abs(z) + EXPLORE_LIMITS.targetMargin);
    top = Math.max(top, y + EXPLORE_LIMITS.targetMargin);
  }
  return new Box3(new Vector3(-half, 0, -half), new Vector3(half, top, half));
}

export interface ExploreControlsProps {
  /** The box the orbit target stays in (see exploreTargetBounds). */
  targetBounds: Box3;
  /** The selected building to frame, or null. */
  focus: BuildingFocus | null;
  /** Lower the DPR while moving (drei regress). Only on the high tier. */
  regress: boolean;
}

/**
 * Free orbit after the intro. Mounted only once the intro is over, and it
 * starts EXACTLY on the director's final pose, so the hand-over has no jump.
 */
export function ExploreControls({ targetBounds, focus, regress }: ExploreControlsProps) {
  const { director } = useSceneRuntime();
  const controls = useRef<CameraControls>(null);

  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { position, target } = director.sample(director.duration).camera;
    // No transition: the camera already sits here, this only syncs the controls' internal state.
    void c.setLookAt(position[0], position[1], position[2], target[0], target[1], target[2], false);
    c.setBoundary(targetBounds);
    // Settle that sync now, while nobody listens: drei subscribes to the controls
    // in a passive effect, after this one. Left for the first frame, the no-op
    // sync would emit an 'update', and drei would regress (DPR down a quarter
    // for 200 ms) on a camera that never moved.
    c.update(0);
  }, [director, targetBounds]);

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
