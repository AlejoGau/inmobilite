import { describe, expect, it } from "vitest";
import { propertyFront } from "@/domain/area/facade";
import type { AreaModel } from "@/domain/types";
import { sampleArea } from "../testing/sampleArea";
import { HERO_SPEC, heroPose, orbitPosition, propertyBearing } from "./cameraPose";

function featured(area: AreaModel, index: number): AreaModel {
  const sorted = [...area.buildings].sort((a, b) => a.distance - b.distance);
  return { ...area, featuredBuildingIds: [sorted[index].id] };
}

describe("hero pose with a searched property", () => {
  it("keeps the classic 3/4 shot when there is no property", () => {
    const area = sampleArea();
    expect(propertyBearing(area)).toBeNull();
    const pose = heroPose(area);
    expect(Math.abs(pose.bearingDeg - HERO_SPEC.bearingDeg)).toBeLessThanOrEqual(HERO_SPEC.bearingJitterDeg);
  });

  it("looks at the property's front from across the street, still inside the hero framing rules", () => {
    const base = sampleArea();
    let checked = 0;
    for (let i = 0; i < Math.min(4, base.buildings.length); i++) {
      const area = featured(base, i);
      const property = propertyFront(area);
      if (!property) continue;
      checked++;
      const pose = heroPose(area);
      const [px, , pz] = orbitPosition(pose.bearingDeg, pose.polarDeg, pose.distance, pose.target);
      // Camera ground position, back in local [east, north].
      const toCamera = [px - property.mid[0], -pz - property.mid[1]];
      const along = toCamera[0] * property.normal[0] + toCamera[1] * property.normal[1];
      expect(along).toBeGreaterThan(0);
      // The look direction is the wall's inward normal, give or take the skew and the reduced jitter.
      const facing = (Math.atan2(-property.normal[0], -property.normal[1]) * 180) / Math.PI;
      const off = Math.abs(((pose.bearingDeg - facing + 540) % 360) - 180);
      expect(off).toBeLessThanOrEqual(HERO_SPEC.facadeSkewDeg + HERO_SPEC.bearingJitterDeg * 0.25 + 1e-6);
      expect(pose.distance).toBeGreaterThanOrEqual(HERO_SPEC.minDistance);
      expect(pose.distance).toBeLessThanOrEqual(HERO_SPEC.maxDistance);
      expect(pose.polarDeg).toBe(HERO_SPEC.polarDeg);
    }
    expect(checked).toBeGreaterThan(1);
  });

  it("is deterministic", () => {
    const area = featured(sampleArea(), 0);
    expect(heroPose(area)).toEqual(heroPose(area));
  });
});
