"use client";

import { useThree } from "@react-three/fiber";
import { Suspense, useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { AreaModel, Building } from "@/domain/types";
import { Beacon } from "./components/Beacon";
import { Buildings } from "./components/Buildings";
import { Effects } from "./components/Effects";
import { Ground } from "./components/Ground";
import { Lighting } from "./components/Lighting";
import { StreetLabels } from "./components/StreetLabels";
import { Trees } from "./components/Trees";
import { PALETTE } from "./config/palette";
import { createDirector } from "./director/director";
import { exploreTargetBounds, ExploreControls, focusFor } from "./runtime/ExploreControls";
import { FrameBus } from "./runtime/frameBus";
import { initialQualityTier, QualityController } from "./runtime/QualityController";
import { SceneDriver } from "./runtime/SceneDriver";
import { SceneRuntimeProvider, type QualityTier, type SceneRuntime } from "./runtime/SceneRuntime";
import type { StageInteraction } from "./runtime/stageInteraction";

/** Linear fog adds depth at low angles; the radial edge fade (groundFx) is what hides the rim. */
const FOG_NEAR = 320;
const FOG_FAR = 1150;

export interface SceneRootProps {
  area: AreaModel;
  playId: number;
  showLabels: boolean;
  selectedBuildingId: string | null;
  onSelectBuilding: (building: Building | null) => void;
  onIntroEnd?: () => void;
  skipIntro: boolean;
  /** Bridge to CityStage's DOM wrapper. While the intro plays, a press on the stage skips it and clicks never select. */
  interaction: StageInteraction;
}

export function SceneRoot({ area, playId, showLabels, selectedBuildingId, onSelectBuilding, onIntroEnd, skipIntro, interaction }: SceneRootProps) {
  const getState = useThree((s) => s.get);

  // One director per play: the hero shot is framed for the viewport the play starts in.
  const director = useMemo(() => {
    const { width, height } = getState().size;
    return createDirector(area, { aspect: height > 0 ? width / height : undefined });
    // playId is not read, but a replay must re-frame the hero shot for the current viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, playId, getState]);
  // No dispose on unmount: the director's timeline is detached from GSAP's global
  // clock, so it is garbage collected with the director, and StrictMode's
  // effect replay can never leave a live director with a killed timeline.

  const startAt = skipIntro ? director.duration : 0;
  const bus = useMemo(() => new FrameBus(director.sample(startAt)), [director, startAt]);

  const [exploredPlay, setExploredPlay] = useState<number | null>(null);
  const exploring = exploredPlay === playId;
  const [quality, setQuality] = useState<QualityTier>(initialQualityTier);

  const runtime = useMemo<SceneRuntime>(() => ({ director, bus, exploring, quality }), [director, bus, exploring, quality]);

  // Each play starts without a pending skip; reduced motion turned on mid-play skips at once.
  useLayoutEffect(() => {
    interaction.setSkipRequested(skipIntro);
  }, [playId, skipIntro, interaction]);
  useLayoutEffect(() => {
    interaction.setIntroPlaying(!exploring);
  }, [exploring, interaction]);

  const handleIntroEnd = useCallback(() => {
    setExploredPlay(playId);
    onIntroEnd?.();
  }, [playId, onIntroEnd]);

  const selected = useMemo(() => area.buildings.find((b) => b.id === selectedBuildingId) ?? null, [area, selectedBuildingId]);
  const focus = useMemo(() => (selected ? focusFor(selected) : null), [selected]);
  const targetBounds = useMemo(() => exploreTargetBounds(area), [area]);

  return (
    <SceneRuntimeProvider value={runtime}>
      <color attach="background" args={[PALETTE.background]} />
      <fog attach="fog" args={[PALETTE.background, FOG_NEAR, FOG_FAR]} />
      <Lighting area={area} />
      <Ground area={area} />
      <Buildings area={area} selectedBuildingId={selectedBuildingId} onSelectBuilding={onSelectBuilding} clickMaySelect={interaction.clickMaySelect} />
      <Trees area={area} />
      <Beacon />
      <Suspense fallback={null}>
        <StreetLabels area={area} show={showLabels} />
      </Suspense>
      <SceneDriver key={playId} startAt={startAt} isSkipRequested={interaction.isSkipRequested} onIntroEnd={handleIntroEnd} />
      {exploring && <ExploreControls targetBounds={targetBounds} focus={focus} regress={quality === "high"} />}
      <QualityController tier={quality} onTierChange={setQuality} />
      <Effects quality={quality} />
    </SceneRuntimeProvider>
  );
}
