"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { Building, GeocodeResult } from "@/domain/types";
import { GlobeFlight, type FlightTarget } from "@/features/flight";
import { SearchBox } from "@/features/search";
import { usePrefersReducedMotion } from "@/ui/usePrefersReducedMotion";
import { AreaRequestError, fetchArea } from "./areaClient";
import { BuildingCard } from "./BuildingCard";
import { buildingsReady, flyingStatus, MODELLING_STATUS } from "./copy";
import { buildDeepLinkSearch, parseDeepLink } from "./deepLink";
import { ErrorToast } from "./ErrorToast";
import { createInitialState, experienceReducer, isStageVisible, type Destination } from "./experienceMachine";
import { Hero } from "./Hero";
import { InfoPanel } from "./InfoPanel";
import { StageLayer } from "./StageLayer";
import { prefetchScene, prewarmStage } from "./stageLoader";
import { StatusLine } from "./StatusLine";
import { TopBar } from "./TopBar";

/**
 * Safety net: if the stage never reports the end of its intro, the controls
 * still appear. Longer than any reasonable intro so it never cuts one short.
 */
const INTRO_FALLBACK_MS = 20_000;

const GENERIC_AREA_ERROR = "Algo falló al modelar la zona. Probá de nuevo.";

function toDestination(result: GeocodeResult): Destination {
  return { label: result.label, secondary: result.secondary, lat: result.lat, lng: result.lng };
}

/**
 * The whole product on one screen: globe → flight → 3D stage → exploring.
 * The state machine (experienceMachine.ts) decides; this component only runs
 * the side effects it asks for and lays out the chrome.
 */
export function Experience() {
  const searchParams = useSearchParams();
  // A deep link is read once, at mount. Later URL updates are ours (replaceState below).
  const [state, dispatch] = useReducer(experienceReducer, searchParams, (params) => createInitialState(parseDeepLink(params)));
  const reducedMotion = usePrefersReducedMotion();
  const { phase, destination, searchId, requestId, arrival, areaStatus, area } = state;

  // The area request runs in parallel with the flight.
  useEffect(() => {
    if (areaStatus !== "loading" || !destination) return;
    const controller = new AbortController();
    fetchArea(destination.lat, destination.lng, controller.signal)
      .then((loaded) => {
        dispatch({ type: "areaLoaded", requestId, area: loaded });
        prewarmStage(loaded);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof AreaRequestError ? error.message : GENERIC_AREA_ERROR;
        dispatch({ type: "areaFailed", requestId, message });
      });
    return () => controller.abort();
  }, [areaStatus, destination, requestId]);

  // A deep link skips the flight, so the 3D chunk is needed right away.
  useEffect(() => {
    if (arrival === "instant" && phase === "flying") prefetchScene();
  }, [arrival, phase]);

  // Once the place is real (its area loaded), the URL becomes shareable.
  useEffect(() => {
    if (areaStatus === "ready" && destination) window.history.replaceState(null, "", buildDeepLinkSearch(destination));
  }, [areaStatus, destination]);

  useEffect(() => {
    if (phase !== "materializing") return;
    const timer = window.setTimeout(() => dispatch({ type: "introEnded" }), INTRO_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [phase, state.playId]);

  const flightTarget = useMemo<FlightTarget | null>(
    () =>
      destination
        ? { key: searchId, lng: destination.lng, lat: destination.lat, mode: arrival === "instant" ? "jump" : "fly" }
        : null,
    [destination, searchId, arrival],
  );

  const pick = useCallback((result: GeocodeResult) => {
    prefetchScene();
    dispatch({ type: "pick", destination: toDestination(result), arrival: "fly" });
  }, []);

  const reset = useCallback(() => {
    window.history.replaceState(null, "", window.location.pathname);
    dispatch({ type: "reset" });
  }, []);

  const onArrive = useCallback((key: number) => dispatch({ type: "flightEnded", searchId: key }), []);
  const onIntroEnd = useCallback(() => dispatch({ type: "introEnded" }), []);
  const onSelectBuilding = useCallback(
    (building: Building | null) => dispatch({ type: "selectBuilding", id: building?.id ?? null }),
    [],
  );
  const closeBuilding = useCallback(() => dispatch({ type: "selectBuilding", id: null }), []);

  const stageVisible = isStageVisible(state);
  const selectedBuilding = stageVisible ? (area?.buildings.find((b) => b.id === state.selectedBuildingId) ?? null) : null;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ground text-text">
      <GlobeFlight target={flightTarget} onArrive={onArrive} />

      <StageLayer
        area={area}
        visible={stageVisible}
        playId={state.playId}
        showLabels={state.showLabels}
        selectedBuildingId={state.selectedBuildingId}
        onSelectBuilding={onSelectBuilding}
        onIntroEnd={onIntroEnd}
        skipIntro={reducedMotion}
      />

      <TopBar
        showSearch={phase === "exploring"}
        onHome={phase === "idle" ? undefined : reset}
        search={
          <SearchBox
            variant="compact"
            placeholder="Buscar otra esquina"
            onPick={pick}
            shortcut={phase === "exploring"}
          />
        }
      />

      <Hero
        visible={phase === "idle"}
        search={<SearchBox variant="hero" onPick={pick} onFirstInput={prefetchScene} shortcut={phase === "idle"} />}
      />

      {phase === "flying" && destination && (
        <StatusLine
          message={state.flightDone ? MODELLING_STATUS : flyingStatus(destination.label)}
          detail={!state.flightDone && area ? buildingsReady(area.stats.buildings) : undefined}
        />
      )}

      {phase === "error" && destination && (
        <ErrorToast
          place={destination.label}
          message={state.errorMessage ?? GENERIC_AREA_ERROR}
          onRetry={() => dispatch({ type: "retry" })}
          onBack={reset}
        />
      )}

      {phase === "exploring" && area && destination && (
        <InfoPanel
          label={destination.label}
          secondary={destination.secondary}
          area={area}
          showLabels={state.showLabels}
          onToggleLabels={() => dispatch({ type: "toggleLabels" })}
          onReplay={() => dispatch({ type: "replay" })}
          onNewSearch={reset}
        />
      )}

      {selectedBuilding && (
        <BuildingCard
          building={selectedBuilding}
          onClose={closeBuilding}
          isSearchedProperty={area?.featuredBuildingIds?.[0] === selectedBuilding.id}
        />
      )}
    </main>
  );
}
