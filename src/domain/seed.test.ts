import { describe, expect, it } from "vitest";
import { hashString, mulberry32, seedFromOrigin } from "./seed";

describe("seed", () => {
  it("hashes strings stably (FNV-1a reference values)", () => {
    expect(hashString("")).toBe(0x811c9dc5);
    expect(hashString("a")).toBe(0xe40c292c);
    expect(hashString("way/1")).toBe(hashString("way/1"));
    expect(hashString("way/1")).not.toBe(hashString("way/2"));
  });

  it("ignores sub-metre float noise in the origin", () => {
    const a = seedFromOrigin({ lat: -34.6183, lng: -58.43646 });
    expect(seedFromOrigin({ lat: -34.618300001, lng: -58.436460002 })).toBe(a);
    expect(seedFromOrigin({ lat: -34.6184, lng: -58.43646 })).not.toBe(a);
  });

  it("produces the same sequence for the same seed, within [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
