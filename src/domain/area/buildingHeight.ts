import type { Building, BuildingUse } from "../types";
import { mulberry32, randomInt } from "../seed";
import type { Tags } from "./osmElements";

/** Typical floor-to-floor height in Buenos Aires, in meters. */
export const LEVEL_HEIGHT = 3.0;
/** Extra height of a shop's ground floor (taller storefronts). */
export const COMMERCIAL_GROUND_FLOOR_BONUS = 1.2;

/**
 * Height profiles drive the estimate. They are finer than BuildingUse:
 * "apartments" and a house are both residential but have very different
 * heights in a Buenos Aires block.
 */
export type HeightProfile =
  | "apartments"
  | "house"
  | "commercial"
  | "largeCommercial"
  | "civic"
  | "minor"
  | "generic";

/** Level ranges (inclusive) that look plausible for Buenos Aires. */
export const LEVEL_RANGES: Record<HeightProfile, readonly [number, number]> = {
  apartments: [7, 14],
  house: [2, 4],
  commercial: [1, 3],
  largeCommercial: [2, 5],
  civic: [2, 6],
  minor: [1, 2],
  generic: [2, 9],
};

/** Footprint above which a shop is assumed to be a bigger, taller store. */
const LARGE_COMMERCIAL_AREA = 600;

/**
 * Weights for building=yes, from 2 to 9 levels. Caballito mixes low PH
 * houses with mid-rise blocks, so low-to-mid heights dominate but towers
 * still appear.
 */
const GENERIC_LEVEL_WEIGHTS = [3, 3, 2.6, 2.2, 1.8, 1.5, 1.2, 1] as const;

const RESIDENTIAL_TYPES = new Set([
  "apartments", "residential", "house", "detached", "semidetached_house", "terrace", "dormitory", "bungalow",
]);
const COMMERCIAL_TYPES = new Set(["commercial", "retail", "office", "supermarket", "kiosk"]);
const CIVIC_TYPES = new Set([
  "school", "kindergarten", "university", "college", "cinema", "theatre", "church", "cathedral", "chapel",
  "mosque", "synagogue", "temple", "religious", "public", "civic", "government", "hospital",
  "train_station", "transportation", "fire_station", "library", "museum", "sports_hall",
]);
const CIVIC_AMENITIES = new Set([
  "school", "kindergarten", "university", "college", "cinema", "theatre", "place_of_worship", "hospital",
  "clinic", "library", "townhall", "police", "fire_station", "community_centre", "arts_centre",
]);
const MINOR_TYPES = new Set(["garage", "garages", "shed", "carport", "roof", "hut", "kiosk_booth"]);

export function resolveUse(tags: Tags): BuildingUse {
  const type = tags.building ?? "yes";
  if (RESIDENTIAL_TYPES.has(type)) return "residential";
  if (COMMERCIAL_TYPES.has(type)) return "commercial";
  if (CIVIC_TYPES.has(type)) return "civic";
  if (tags.amenity && CIVIC_AMENITIES.has(tags.amenity)) return "civic";
  if (tags.shop || tags.office || tags.amenity) return "commercial";
  return "other";
}

export function resolveProfile(tags: Tags, use: BuildingUse, area: number): HeightProfile {
  const type = tags.building ?? "yes";
  if (type === "apartments") return "apartments";
  if (use === "residential") return "house";
  if (use === "commercial") return area > LARGE_COMMERCIAL_AREA ? "largeCommercial" : "commercial";
  if (use === "civic") return "civic";
  if (MINOR_TYPES.has(type)) return "minor";
  return "generic";
}

export type BuildingHeight = Pick<Building, "height" | "levels" | "heightSource">;

/**
 * Real height when OSM has it, otherwise a deterministic estimate seeded by
 * the building itself, so a building never changes height between visits.
 */
export function resolveHeight(tags: Tags, use: BuildingUse, area: number, seed: number): BuildingHeight {
  const groundBonus = use === "commercial" ? COMMERCIAL_GROUND_FLOOR_BONUS : 0;
  const taggedLevels = parseLevels(tags["building:levels"]);
  const taggedHeight = parseHeightMeters(tags.height);

  if (taggedHeight !== null) {
    return {
      height: round1(taggedHeight),
      levels: taggedLevels ?? Math.max(1, Math.round(taggedHeight / LEVEL_HEIGHT)),
      heightSource: "osm",
    };
  }
  if (taggedLevels !== null) {
    return { height: round1(taggedLevels * LEVEL_HEIGHT + groundBonus), levels: taggedLevels, heightSource: "osm" };
  }

  const levels = estimateLevels(resolveProfile(tags, use, area), area, seed);
  return { height: round1(levels * LEVEL_HEIGHT + groundBonus), levels, heightSource: "estimated" };
}

export function estimateLevels(profile: HeightProfile, area: number, seed: number): number {
  const rng = mulberry32(seed);
  const [min, max] = LEVEL_RANGES[profile];
  if (profile === "generic") return pickWeightedLevel(rng(), area);
  if (profile === "apartments" && area > 400) {
    // Big apartment footprints are usually the taller towers: best of two draws.
    return Math.max(randomInt(rng, min, max), randomInt(rng, min, max));
  }
  return randomInt(rng, min, max);
}

function pickWeightedLevel(r: number, area: number): number {
  const [min] = LEVEL_RANGES.generic;
  // A footprint this small is a narrow PH lot; a tower on it would look absurd.
  const weights = area < 80 ? GENERIC_LEVEL_WEIGHTS.slice(0, 3) : GENERIC_LEVEL_WEIGHTS;
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / total;
    if (r < acc) return min + i;
  }
  return min + weights.length - 1;
}

function parseLevels(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 1 || n > 200) return null;
  return Math.round(n);
}

/** Parses "12", "12.5", "12 m" or "40'" into meters. */
function parseHeightMeters(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const meters = /ft|'/.test(raw) ? n * 0.3048 : n;
  return meters >= 2 && meters <= 600 ? meters : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
