import { describe, expect, it } from "vitest";
import { sampleArea } from "../testing/sampleArea";
import { fontSizeFor, formatStreetName, uprightAngle } from "./labelLayout";

describe("street label layout", () => {
  it("abbreviates avenues and uppercases with Spanish rules", () => {
    expect(formatStreetName("Avenida José María Moreno")).toBe("AV. JOSÉ MARÍA MORENO");
    expect(formatStreetName("Rosario")).toBe("ROSARIO");
  });

  it("keeps flat text upright", () => {
    for (const angle of [-3, -2, -1.5, -0.5, 0, 0.5, 1.5, 2, 3, 7]) {
      const a = uprightAngle(angle);
      expect(a).toBeGreaterThan(-Math.PI / 2);
      expect(a).toBeLessThanOrEqual(Math.PI / 2);
      // Same street direction, possibly flipped by 180°.
      expect(Math.abs(Math.sin(a - angle))).toBeLessThan(1e-9);
    }
  });

  it("sizes avenue names bigger than side streets", () => {
    const area = sampleArea();
    const avenue = fontSizeFor({ name: "Avenida Rivadavia", position: [0, 0], angle: 0 }, area);
    const street = fontSizeFor({ name: "Rosario", position: [0, 0], angle: 0 }, area);
    expect(avenue).toBeGreaterThan(street);
  });
});
