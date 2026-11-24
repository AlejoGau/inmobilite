"use client";

import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import type { Director } from "../director/director";
import type { FrameBus, FrameListener } from "./frameBus";

export type QualityTier = "high" | "low";

/**
 * What every scene component may know: the director (timing), the frame bus
 * (the current instant), whether the intro has handed over to free
 * exploration, and the quality tier. The last two are React state and change
 * a handful of times per session, never per frame.
 */
export interface SceneRuntime {
  director: Director;
  bus: FrameBus;
  exploring: boolean;
  quality: QualityTier;
}

const SceneRuntimeContext = createContext<SceneRuntime | null>(null);

export function SceneRuntimeProvider({ value, children }: { value: SceneRuntime; children: ReactNode }) {
  return <SceneRuntimeContext.Provider value={value}>{children}</SceneRuntimeContext.Provider>;
}

export function useSceneRuntime(): SceneRuntime {
  const runtime = useContext(SceneRuntimeContext);
  if (!runtime) throw new Error("Scene components must be rendered inside <CityStage>");
  return runtime;
}

/**
 * Registers an imperative callback for every director frame. This is how
 * visual components animate: they update uniforms and refs from the frame,
 * and never call useFrame or read a clock themselves.
 *
 * The subscription happens in a layout effect and replays the current frame
 * at once, so a component is correct from its very first rendered frame.
 */
export function useDirectorFrame(listener: FrameListener): void {
  const { bus } = useSceneRuntime();
  const latest = useRef(listener);
  useLayoutEffect(() => {
    latest.current = listener;
  });
  useLayoutEffect(() => bus.subscribe((frame) => latest.current(frame)), [bus]);
}
