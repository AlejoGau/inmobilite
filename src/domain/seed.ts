import type { LngLat } from "./types";

/**
 * Deterministic seeding. Domain and scene code never call Math.random: every
 * random-looking choice comes from a PRNG seeded here, so the same origin
 * always yields the same model and the same intro.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a hash of a string, as an unsigned integer. */
export function hashString(s: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Seed for an area. Coordinates are rounded to 5 decimals (about 1 m) so
 * that two geocoders returning the same corner with float noise agree.
 */
export function seedFromOrigin(o: LngLat): number {
  return hashString(`${o.lat.toFixed(5)},${o.lng.toFixed(5)}`);
}

/** Mulberry32: tiny, fast, good-enough PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [min, max). */
export function randomBetween(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Uniform integer in [min, max], both inclusive. */
export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
