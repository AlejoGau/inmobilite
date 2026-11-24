/**
 * Art direction: "maqueta arquitectónica al atardecer".
 * All colours are sRGB hex strings; three converts them to the linear working
 * space when they become a THREE.Color, so lighting maths stays linear.
 */
export const PALETTE = {
  /** Deep blue-slate sky and fog. Everything at the edge dissolves into it. */
  background: "#121722",
  asphalt: "#262c37",
  /** Sidewalk band along every kerb: the lightest ground surface. */
  sidewalk: "#8b867e",
  /** Block interiors behind the sidewalk band: a step darker than the sidewalk. */
  lot: "#5f5c57",
  kerb: "#a29d95",
  park: "#66775d",
  parkEdge: "#56644f",
  markingCentre: "#9da3ab",
  markingEdge: "#b9bec4",
  crosswalk: "#d9dcdf",
  clay: "#e9e5de",
  windowGlass: "#1b222d",
  windowGlowWarm: "#ffb86b",
  windowGlowSoft: "#ffd7a6",
  storefrontGlow: "#ffc888",
  treeCrown: "#5b7052",
  treeTrunk: "#4b3f35",
  accent: "#14b8a6",
  labelText: "#f3f5f7",
  sunLight: "#ffc893",
  hemisphereSky: "#8aa0c4",
  hemisphereGround: "#2a2621",
} as const;

/**
 * Vertical layering of flat surfaces, in meters. Spacing is generous enough
 * that depth precision alone resolves it at every allowed camera distance;
 * markings still use polygonOffset because they are paper-thin.
 */
export const LAYERS = {
  asphalt: 0.02,
  marking: 0.035,
  beacon: 0.05,
  label: 0.06,
  /** Top of the kerb: sidewalks and block plinths. */
  sidewalk: 0.15,
  /** Block interiors sit a hair above the sidewalk so the two never z-fight. */
  lot: 0.17,
  /**
   * Parks sit ON the block plinth (the plinth is carved by the streets), so
   * their "slightly raised" lawn is 0.08 m above the sidewalk, not above 0.
   */
  park: 0.23,
} as const;

/** Sidewalk width from the kerb to the building line, in meters. */
export const SIDEWALK_WIDTH = 3.2;
