"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Map as MapLibreMap, MapLibreEvent } from "maplibre-gl";
import { HANDOFF_CAMERA } from "@/domain/handoffCamera";
import { cn } from "@/ui/cn";
import { usePrefersReducedMotion } from "@/ui/usePrefersReducedMotion";
import { applyGlobePalette } from "./globePalette";
import { configureMaplibreWorker } from "./maplibreWorker";
import {
  arrivalCamera,
  flightHome,
  flightTo,
  homeCamera,
  isNearHome,
  MAP_STYLE_URL,
  ROTATION_DEG_PER_SECOND,
  SKY,
} from "./camera";

export interface FlightTarget {
  /** Identifies one flight; `onArrive` reports it back. */
  key: number;
  lng: number;
  lat: number;
  /** "jump" lands at once (deep links). Reduced motion always jumps. */
  mode: "fly" | "jump";
}

export interface GlobeFlightProps {
  /** null = the idle globe, slowly spinning over South America. */
  target: FlightTarget | null;
  onArrive: (key: number) => void;
  className?: string;
}

/** Tags our own camera moves, so a `moveend` from an interrupted flight is not taken as an arrival. */
const HOME_FLIGHT_KEY = -1;

function flightKeyOf(event: MapLibreEvent): unknown {
  return (event as MapLibreEvent & { flightKey?: unknown }).flightKey;
}

/**
 * The MapLibre globe behind everything. It stays mounted under the 3D stage so
 * "Nueva búsqueda" can fly back out from where the stage was.
 *
 * Declarative on purpose: the parent says where the camera should be, and the
 * component owns how it gets there.
 */
export function GlobeFlight({ target, onArrive, className }: GlobeFlightProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The first target decides where the map is born: a deep link starts already at the corner.
  const initialTarget = useRef(target);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const arrive = useEffectEvent((key: number) => onArrive(key));

  useEffect(() => {
    let disposed = false;
    let instance: MapLibreMap | null = null;

    // maplibre touches `window` on import, so it only loads in the browser.
    import("maplibre-gl")
      .then((maplibre) => {
        configureMaplibreWorker(maplibre);
        const { Map } = maplibre;
        const container = containerRef.current;
        if (disposed || !container) return;
        const start = initialTarget.current;
        const camera = start
          ? arrivalCamera(start.lng, start.lat, container.clientHeight)
          : homeCamera({ width: container.clientWidth, height: container.clientHeight });
        try {
          instance = new Map({
            container,
            style: MAP_STYLE_URL,
            ...camera,
            interactive: false,
            attributionControl: { compact: true },
            fadeDuration: 200,
          });
        } catch {
          // No WebGL2: arrive at once, without a globe. The 3D stage needs WebGL2 too, so it
          // will show its fallback (StageLayer) while the panel and the search keep working.
          setFailed(true);
          return;
        }
        const created = instance;
        // Pinned rather than relying on MapLibre's default: the 3D intro uses the same value.
        created.setVerticalFieldOfView(HANDOFF_CAMERA.fovDeg);
        created.on("style.load", () => {
          created.setProjection({ type: "globe" });
          created.setSky(SKY);
          applyGlobePalette(created);
        });
        setMap(created);
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      instance?.remove();
    };
  }, []);

  const key = target?.key ?? null;
  const lng = target?.lng ?? 0;
  const lat = target?.lat ?? 0;
  const mode = target?.mode ?? "fly";

  useEffect(() => {
    if (!map) {
      if (failed && key !== null) arrive(key);
      return;
    }
    const container = map.getContainer();
    const viewport = { width: container.clientWidth, height: container.clientHeight };

    if (key === null) return goHome(map, viewport, reducedMotion);

    // The arrival zoom depends on the viewport height (camera.ts). A flight lands on
    // the zoom computed at take-off, so the pose is re-applied from the live height on
    // landing and on every resize after it (a phone rotated mid-flight or while the
    // area loads): the crossfade into the 3D intro must keep its scale. Its own
    // moveend carries no flightKey, so it never counts as an arrival.
    const holdArrival = () => map.jumpTo(arrivalCamera(lng, lat, container.clientHeight));
    const onResize = () => {
      if (!map.isMoving()) holdArrival();
    };

    if (mode === "jump" || reducedMotion) {
      map.stop();
      holdArrival();
      map.on("resize", onResize);
      arrive(key);
      return () => {
        map.off("resize", onResize);
      };
    }

    const onMoveEnd = (event: MapLibreEvent) => {
      if (flightKeyOf(event) !== key) return;
      holdArrival();
      map.on("resize", onResize);
      arrive(key);
    };
    // Listen before flying: flyTo first stops the previous flight, whose moveend carries the old key.
    map.on("moveend", onMoveEnd);
    map.flyTo(flightTo(lng, lat, viewport.height), { flightKey: key });
    return () => {
      map.off("moveend", onMoveEnd);
      map.off("resize", onResize);
    };
  }, [map, failed, key, lng, lat, mode, reducedMotion]);

  return (
    <div className={cn("globe-flight absolute inset-0 bg-ground", className)}>
      {/* MapLibre requires an empty container with real dimensions. */}
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

/** Flies back to the globe (unless already there), then spins it. Returns the cleanup. */
function goHome(map: MapLibreMap, viewport: { width: number; height: number }, reducedMotion: boolean): () => void {
  if (reducedMotion) {
    map.stop();
    map.jumpTo(homeCamera(viewport));
    return () => {};
  }

  let frame = 0;
  let last: number | null = null;
  const spin = (now: number) => {
    if (last !== null) {
      const center = map.getCenter();
      map.setCenter([center.lng + (ROTATION_DEG_PER_SECOND * (now - last)) / 1000, center.lat]);
    }
    last = now;
    frame = requestAnimationFrame(spin);
  };
  const startSpin = () => {
    frame = requestAnimationFrame(spin);
  };

  const onMoveEnd = (event: MapLibreEvent) => {
    if (flightKeyOf(event) === HOME_FLIGHT_KEY) startSpin();
  };

  if (isNearHome(map.getZoom())) {
    startSpin();
  } else {
    map.on("moveend", onMoveEnd);
    map.flyTo(flightHome(viewport), { flightKey: HOME_FLIGHT_KEY });
  }

  return () => {
    cancelAnimationFrame(frame);
    map.off("moveend", onMoveEnd);
  };
}
