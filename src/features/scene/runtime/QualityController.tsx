"use client";

import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { useStore, useThree, type RootState } from "@react-three/fiber";
import { useEffect, useLayoutEffect } from "react";
import type { QualityTier } from "./SceneRuntime";

export const DPR_RANGE: [number, number] = [1, 2];

/** The low tier draws one device pixel per CSS pixel. */
const LOW_TIER_DPR = 1;

/** Coarse pointers are phones and tablets: start them on the light tier and let them earn the high one. */
export function initialQualityTier(): QualityTier {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "high";
  return window.matchMedia("(pointer: coarse)").matches ? "low" : "high";
}

export interface QualityControllerProps {
  tier: QualityTier;
  onTierChange: (tier: QualityTier) => void;
}

/**
 * Adaptive quality. PerformanceMonitor moves between two tiers (and settles
 * after a few flip-flops); the high tier clamps DPR to [1, 2] and lets
 * AdaptiveDpr lower it while the camera moves, the low tier pins DPR to 1.
 *
 * The Canvas keeps dpr={DPR_RANGE} on every tier: R3F freezes
 * viewport.initialDpr at the first ratio it resolves and AdaptiveDpr scales
 * from it, so a phone that starts on the low tier must still resolve its
 * device ratio first.
 */
export function QualityController({ tier, onTierChange }: QualityControllerProps) {
  const store = useStore();
  const setDpr = useThree((s) => s.setDpr);

  // Setting DPR 1 once is not enough: R3F applies the Canvas dpr again on every
  // Canvas render (the end of the intro, a selection, a resize) and when the
  // display's ratio changes, and AdaptiveDpr restores its base as it unmounts.
  // A store subscription answers each of those writes at once, before any frame
  // is drawn; an effect driven by renders misses a write that lands between two.
  useLayoutEffect(() => {
    if (tier !== "low") return;
    const pin = (state: RootState) => {
      if (state.viewport.dpr !== LOW_TIER_DPR) state.setDpr(LOW_TIER_DPR);
    };
    pin(store.getState());
    return store.subscribe(pin);
  }, [tier, store]);

  useEffect(() => {
    if (tier === "low") return;
    const device = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    setDpr(Math.min(DPR_RANGE[1], Math.max(DPR_RANGE[0], device)));
  }, [tier, setDpr]);

  return (
    <>
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => onTierChange("low")}
        onIncline={() => onTierChange("high")}
        onFallback={() => onTierChange("low")}
      />
      {tier === "high" && <AdaptiveDpr />}
    </>
  );
}
