import { Color, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from "three";
import { mulberry32, randomBetween } from "@/domain/seed";
import type { Building } from "@/domain/types";
import { PALETTE } from "../config/palette";
import { FACADE_ATTRIBUTE, type BuildingMeshData } from "../geometry/buildingGeometry";

/** Facade grammar, in meters. */
export const FACADE_SPEC = {
  windowPitch: 2.6,
  windowWidth: 1.4,
  minFloorHeight: 2.7,
  maxFloorHeight: 4.2,
  /** Share of lit windows at dusk, per building. */
  litRatio: [0.35, 0.55] as const,
  /** Emissive strength of a lit window: the brighter ones cross the bloom threshold, the dimmer ones do not. */
  windowGlow: 3.0,
  storefrontGlow: 2.2,
} as const;

export interface BuildingUniforms {
  /** Current vertical scale of the mesh (0..1), so the edge light keeps a constant width. */
  uScaleY: { value: number };
  /** Rising edge light, 0..1. */
  uEdgeGlow: { value: number };
  /** Hover / selection highlight, 0..1. */
  uHighlight: { value: number };
  uRimHeight: { value: number };
  uWallHeight: { value: number };
  uFloorHeight: { value: number };
  uLevels: { value: number };
  uCommercial: { value: number };
  uSeed: { value: number };
  uLitRatio: { value: number };
  uWindowIntensity: { value: number };
  uStoreIntensity: { value: number };
  uGlassColor: { value: Color };
  uGlowWarm: { value: Color };
  uGlowSoft: { value: Color };
  uStoreGlow: { value: Color };
  uAccent: { value: Color };
}

const VERTEX_PARS = /* glsl */ `
attribute vec3 ${FACADE_ATTRIBUTE};
varying vec3 vFacade;
varying float vBldHeight;
`;

const VERTEX_MAIN = /* glsl */ `
vFacade = ${FACADE_ATTRIBUTE};
// Object-space height: unaffected by the rise scale, so windows never squash.
vBldHeight = position.y;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uScaleY;
uniform float uEdgeGlow;
uniform float uHighlight;
uniform float uRimHeight;
uniform float uWallHeight;
uniform float uFloorHeight;
uniform float uLevels;
uniform float uCommercial;
uniform float uSeed;
uniform float uLitRatio;
uniform float uWindowIntensity;
uniform float uStoreIntensity;
uniform vec3 uGlassColor;
uniform vec3 uGlowWarm;
uniform vec3 uGlowSoft;
uniform vec3 uStoreGlow;
uniform vec3 uAccent;
varying vec3 vFacade;
varying float vBldHeight;

// Hash without sine (Dave Hoskins): stable across GPUs, unlike fract(sin()).
float bldHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Anti-aliased "inside |x| < halfWidth".
float bldBand(float x, float halfWidth, float aa) {
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(x));
}
`;

const PITCH = FACADE_SPEC.windowPitch.toFixed(3);
const HALF_WINDOW = (FACADE_SPEC.windowWidth / 2).toFixed(3);

const FRAGMENT_MAIN = /* glsl */ `
{
  float h = vBldHeight;
  float halfLen = vFacade.z;
  if (halfLen > 0.0) {
    float u = vFacade.x;
    float edgeId = vFacade.y;
    vec2 aa = max(fwidth(vec2(u, h)), vec2(1e-4)) * 0.75;

    float floorIdx = floor(h / uFloorHeight);
    float fv = h - floorIdx * uFloorHeight;
    float colIdx = floor(u / ${PITCH} + 0.5);
    float fu = u - colIdx * ${PITCH};

    // A column exists only if the whole window fits on this facade.
    float fits = step(abs(colIdx) * ${PITCH} + ${HALF_WINDOW} + 0.45, halfLen);
    float onFloor = step(floorIdx + 1.0, uLevels + 0.01) * (1.0 - step(uWallHeight - 0.3, h));
    float sill = uFloorHeight * 0.3;
    float head = uFloorHeight * 0.82;
    float inCol = bldBand(fu, ${HALF_WINDOW}, aa.x);
    float inRow = smoothstep(sill - aa.y, sill + aa.y, fv) * (1.0 - smoothstep(head - aa.y, head + aa.y, fv));
    float isGround = 1.0 - step(1.0, floorIdx);
    float winMask = inCol * inRow * fits * onFloor * (1.0 - isGround * uCommercial);

    // Ground floor of shops: one wide glass band with mullions every 3.2 m.
    float storeU = bldBand(u, halfLen - 0.8, aa.x);
    float storeV = smoothstep(0.35 - aa.y, 0.35 + aa.y, h) * (1.0 - smoothstep(uFloorHeight * 0.84 - aa.y, uFloorHeight * 0.84 + aa.y, h));
    float mullion = bldBand(fract(u / 3.2 + 0.5) - 0.5, 0.06 / 3.2, aa.x / 3.2);
    float store = uCommercial * isGround * storeU * storeV * (1.0 - mullion) * step(1.8, halfLen);

    // Recessed look: the head and jambs of each opening are in shadow.
    float recess = max(smoothstep(head - 0.24, head, fv), 0.7 * smoothstep(${HALF_WINDOW} - 0.14, ${HALF_WINDOW}, abs(fu)));

    // Floor slab lines between storeys.
    float slab = (1.0 - smoothstep(0.12, 0.12 + aa.y, fv)) * step(0.5, floorIdx) * onFloor;
    diffuseColor.rgb *= 1.0 - 0.1 * slab;

    vec2 cell = vec2(colIdx + edgeId * 41.0, floorIdx) + uSeed;
    float lit = step(bldHash(cell), uLitRatio);
    vec3 glow = mix(uGlowSoft, uGlowWarm, bldHash(cell * 1.7 + 11.3)) * (0.65 + 0.6 * bldHash(cell + 3.1));
    float storeLit = step(bldHash(vec2(edgeId, 7.0) + uSeed), 0.75);

    float glass = max(winMask, store);
    diffuseColor.rgb = mix(diffuseColor.rgb, uGlassColor * (1.0 - 0.55 * recess), glass);
    roughnessFactor = mix(roughnessFactor, 0.14, glass);
    totalEmissiveRadiance += winMask * lit * glow * uWindowIntensity * (1.0 - 0.7 * recess);
    totalEmissiveRadiance += store * storeLit * uStoreGlow * uStoreIntensity;
  }

  // Soft light line riding on top of the building while it rises.
  float band = 0.6 / max(uScaleY, 0.04);
  float rim = smoothstep(uRimHeight - band, uRimHeight, h) * (1.0 - step(uRimHeight + 0.01, h));
  totalEmissiveRadiance += uAccent * (rim * uEdgeGlow * 4.0);

  // Hover and selection: a teal fresnel rim plus a faint tint.
  float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += uAccent * (uHighlight * (0.06 + 0.8 * pow(1.0 - facing, 2.5)));
}
`;

function inject(source: string, anchor: string, code: string): string {
  if (!source.includes(anchor)) throw new Error(`Shader anchor not found: ${anchor}`);
  return source.replace(anchor, `${anchor}\n${code}`);
}

function patchBuildingShader(shader: WebGLProgramParametersWithUniforms, uniforms: BuildingUniforms): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = inject(shader.vertexShader, "#include <common>", VERTEX_PARS);
  shader.vertexShader = inject(shader.vertexShader, "#include <begin_vertex>", VERTEX_MAIN);
  shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_PARS);
  // After the emissive chunk and before lighting: albedo, roughness and
  // emissive edits all land in the physically based lighting below.
  shader.fragmentShader = inject(shader.fragmentShader, "#include <emissivemap_fragment>", FRAGMENT_MAIN);
}

/** Warm clay with a tiny seeded drift, so neighbours read as different buildings without turning garish. */
export function clayColour(seed: number): Color {
  const rng = mulberry32(seed ^ 0x27d4eb2d);
  return new Color(PALETTE.clay).offsetHSL(randomBetween(rng, -0.012, 0.012), randomBetween(rng, -0.04, 0.03), randomBetween(rng, -0.035, 0.02));
}

export interface BuildingMaterial {
  material: MeshStandardMaterial;
  uniforms: BuildingUniforms;
}

export function createBuildingMaterial(building: Building, mesh: BuildingMeshData): BuildingMaterial {
  const rng = mulberry32(building.seed ^ 0x165667b1);
  const levels = Math.max(1, building.levels);
  const floorHeight = Math.min(FACADE_SPEC.maxFloorHeight, Math.max(FACADE_SPEC.minFloorHeight, mesh.wallHeight / levels));
  const uniforms: BuildingUniforms = {
    uScaleY: { value: 1 },
    uEdgeGlow: { value: 0 },
    uHighlight: { value: 0 },
    uRimHeight: { value: mesh.rimHeight },
    uWallHeight: { value: mesh.wallHeight },
    uFloorHeight: { value: floorHeight },
    uLevels: { value: levels },
    uCommercial: { value: building.use === "commercial" ? 1 : 0 },
    // Small and well inside float precision: the raw seed is a 32-bit integer.
    uSeed: { value: (building.seed % 9973) * 0.731 },
    uLitRatio: { value: randomBetween(rng, FACADE_SPEC.litRatio[0], FACADE_SPEC.litRatio[1]) },
    uWindowIntensity: { value: FACADE_SPEC.windowGlow },
    uStoreIntensity: { value: FACADE_SPEC.storefrontGlow },
    uGlassColor: { value: new Color(PALETTE.windowGlass) },
    uGlowWarm: { value: new Color(PALETTE.windowGlowWarm) },
    uGlowSoft: { value: new Color(PALETTE.windowGlowSoft) },
    uStoreGlow: { value: new Color(PALETTE.storefrontGlow) },
    uAccent: { value: new Color(PALETTE.accent) },
  };
  const material = new MeshStandardMaterial({ color: clayColour(building.seed), roughness: 0.85, metalness: 0 });
  material.onBeforeCompile = (shader) => patchBuildingShader(shader, uniforms);
  // Every building runs the same shader code; only uniforms differ.
  material.customProgramCacheKey = () => "inmobilite-building-v1";
  return { material, uniforms };
}
