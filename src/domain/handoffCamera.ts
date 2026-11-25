/**
 * The camera pose where the MapLibre flight ends and the 3D intro begins.
 *
 * The flight (features/flight) and the scene (features/scene) both read it
 * from here, so the crossfade between the map and the scene lines up exactly.
 * It lives in the domain as plain constants so the map bundle never has to
 * import the scene, which would pull three.js into it.
 *
 * - altitude: meters above the ground at the centre of the view.
 * - pitchDeg: tilt from straight down (MapLibre `pitch`).
 * - bearingDeg: 0 = looking north (MapLibre `bearing`).
 * - fovDeg: vertical field of view, MapLibre's default.
 */
export const HANDOFF_CAMERA = {
  altitude: 380,
  pitchDeg: 12,
  bearingDeg: 0,
  fovDeg: 36.87,
} as const;

/** Distance from the camera to the point it looks at, along the line of sight. */
export function handoffCameraDistance(): number {
  return HANDOFF_CAMERA.altitude / Math.cos((HANDOFF_CAMERA.pitchDeg * Math.PI) / 180);
}
