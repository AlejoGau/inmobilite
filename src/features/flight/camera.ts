import type { FlyToOptions, JumpToOptions, SkySpecification } from "maplibre-gl";

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/** The idle globe looks at South America. */
const HOME_CENTER: [number, number] = [-60, -34];
const HOME_ZOOM_DESKTOP = 2.2;
/** A phone is narrower than the globe at 2.2, so it backs off to keep the whole sphere in frame. */
const HOME_ZOOM_PHONE = 1.35;
const PHONE_MAX_WIDTH = 640;

/** Degrees of longitude per second for the idle spin: slow enough to read as ambient. */
export const ROTATION_DEG_PER_SECOND = 2.4;

/** Arrival camera: close, pitched and slightly turned, matching where the 3D stage opens. */
export const ARRIVAL = { zoom: 16.8, pitch: 55, bearing: -15 } as const;

const FLIGHT = { duration: 5000, curve: 1.6 } as const;
const HOME_FLIGHT = { duration: 3400, curve: 1.4 } as const;

/** The deep blue-slate of the 3D stage, so the map and the scene share one horizon. */
export const SKY: SkySpecification = {
  "sky-color": "#0e1218",
  "horizon-color": "#1a2331",
  "fog-color": "#0e1218",
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.5,
  "fog-ground-blend": 0.5,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0.6, 10, 0],
};

interface Viewport {
  width: number;
  height: number;
}

/**
 * The idle globe rises from the bottom of the frame, under the hero copy: the
 * top padding pushes its centre down by a quarter of the screen.
 */
export function homeCamera(viewport: Viewport): JumpToOptions {
  return {
    center: HOME_CENTER,
    zoom: viewport.width < PHONE_MAX_WIDTH ? HOME_ZOOM_PHONE : HOME_ZOOM_DESKTOP,
    pitch: 0,
    bearing: 0,
    padding: { top: Math.round(viewport.height * 0.46), bottom: 0, left: 0, right: 0 },
  };
}

export function arrivalCamera(lng: number, lat: number): JumpToOptions {
  return { center: [lng, lat], ...ARRIVAL, padding: { top: 0, bottom: 0, left: 0, right: 0 } };
}

export function flightTo(lng: number, lat: number): FlyToOptions {
  // `essential` keeps MapLibre from skipping it: reduced motion is handled by the caller with a jump.
  return { ...arrivalCamera(lng, lat), ...FLIGHT, essential: true };
}

export function flightHome(viewport: Viewport): FlyToOptions {
  return { ...homeCamera(viewport), ...HOME_FLIGHT, essential: true };
}

/** Above this zoom the camera is "down at a street", not looking at the globe. */
export function isNearHome(zoom: number): boolean {
  return zoom < 4;
}
