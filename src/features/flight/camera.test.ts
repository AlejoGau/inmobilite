import { describe, expect, it } from "vitest";
import { HANDOFF_CAMERA, handoffCameraDistance } from "@/domain/handoffCamera";
import { arrivalCamera, zoomForCameraDistance } from "./camera";

const ACOYTE_Y_RIVADAVIA = { lng: -58.43646, lat: -34.6183 };

/** MapLibre's camera-to-centre distance in meters, for a zoom (the inverse of zoomForCameraDistance). */
function cameraDistanceForZoom(zoom: number, latDeg: number, viewportHeightPx: number, fovDeg: number): number {
  const cameraToCenterPx = (0.5 * viewportHeightPx) / Math.tan((fovDeg * Math.PI) / 360);
  const worldSizePx = 512 * 2 ** zoom;
  const metersPerPixel = (40_075_016.686 * Math.cos((latDeg * Math.PI) / 180)) / worldSizePx;
  return cameraToCenterPx * metersPerPixel;
}

describe("zoomForCameraDistance", () => {
  it("puts MapLibre's camera exactly at the requested distance", () => {
    for (const height of [640, 900, 1200]) {
      const zoom = zoomForCameraDistance(388.5, ACOYTE_Y_RIVADAVIA.lat, height, 36.87);
      expect(cameraDistanceForZoom(zoom, ACOYTE_Y_RIVADAVIA.lat, height, 36.87)).toBeCloseTo(388.5, 6);
    }
  });

  it("gives a street-level zoom for the handoff pose in Buenos Aires", () => {
    // 900 px tall viewport: about zoom 17.8.
    const zoom = zoomForCameraDistance(handoffCameraDistance(), ACOYTE_Y_RIVADAVIA.lat, 900, HANDOFF_CAMERA.fovDeg);
    expect(zoom).toBeGreaterThan(17.6);
    expect(zoom).toBeLessThan(17.9);
  });

  it("zooms in on taller viewports, so the distance in meters stays the same", () => {
    const short = zoomForCameraDistance(400, ACOYTE_Y_RIVADAVIA.lat, 600, 36.87);
    const tall = zoomForCameraDistance(400, ACOYTE_Y_RIVADAVIA.lat, 1200, 36.87);
    expect(tall - short).toBeCloseTo(1, 6);
  });
});

describe("arrivalCamera", () => {
  it("matches the pose where the 3D intro starts", () => {
    const camera = arrivalCamera(ACOYTE_Y_RIVADAVIA.lng, ACOYTE_Y_RIVADAVIA.lat, 900);
    expect(camera.center).toEqual([ACOYTE_Y_RIVADAVIA.lng, ACOYTE_Y_RIVADAVIA.lat]);
    expect(camera.pitch).toBe(HANDOFF_CAMERA.pitchDeg);
    expect(camera.bearing).toBe(HANDOFF_CAMERA.bearingDeg);
    const distance = cameraDistanceForZoom(camera.zoom ?? 0, ACOYTE_Y_RIVADAVIA.lat, 900, HANDOFF_CAMERA.fovDeg);
    expect(distance).toBeCloseTo(handoffCameraDistance(), 6);
  });
});
