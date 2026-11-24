import { Color, type Material, type WebGLProgramParametersWithUniforms } from "three";

/**
 * Two radial effects shared by every flat layer (asphalt, plinths, parks,
 * paint, trees):
 *
 * - Reveal: fragments beyond `uRevealRadius` are discarded, with a soft,
 *   faintly lit front, so each layer grows out of the corner.
 * - Edge fade: towards the rim of the disc, surfaces blend into the
 *   background colour. Distance fog alone cannot do this from a top-down
 *   camera (the whole disc is at the same distance), and it is what hides the
 *   hard edge of the 300 m area.
 *
 * The blend happens after three's fog, in linear HDR space, exactly like the
 * background, so both go through the same tone mapping.
 */
export interface GroundFxUniforms {
  uRevealRadius: { value: number };
  uRevealSoftness: { value: number };
  uFadeStart: { value: number };
  uFadeEnd: { value: number };
  uFadeColor: { value: Color };
  uFrontColor: { value: Color };
  uFrontStrength: { value: number };
}

export interface GroundFxOptions {
  fadeStart: number;
  fadeEnd: number;
  background: string;
  frontColor: string;
  frontStrength: number;
  softness: number;
}

export function createGroundFxUniforms(options: GroundFxOptions): GroundFxUniforms {
  return {
    uRevealRadius: { value: 0 },
    uRevealSoftness: { value: options.softness },
    uFadeStart: { value: options.fadeStart },
    uFadeEnd: { value: options.fadeEnd },
    uFadeColor: { value: new Color(options.background) },
    uFrontColor: { value: new Color(options.frontColor) },
    uFrontStrength: { value: options.frontStrength },
  };
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vFxWorld;
`;

const VERTEX_MAIN = /* glsl */ `
{
  vec4 fxLocal = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fxLocal = instanceMatrix * fxLocal;
  #endif
  vFxWorld = (modelMatrix * fxLocal).xyz;
}
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uRevealRadius;
uniform float uRevealSoftness;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform vec3 uFadeColor;
uniform vec3 uFrontColor;
uniform float uFrontStrength;
varying vec3 vFxWorld;
`;

const FRAGMENT_DISCARD = /* glsl */ `
float fxDistance = length(vFxWorld.xz);
if (fxDistance > uRevealRadius) discard;
`;

const FRAGMENT_BLEND = /* glsl */ `
{
  float fxEdge = smoothstep(uFadeStart, uFadeEnd, fxDistance);
  float fxFront = 1.0 - smoothstep(0.0, uRevealSoftness, uRevealRadius - fxDistance);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, max(fxEdge, fxFront * 0.8));
  gl_FragColor.rgb += uFrontColor * (uFrontStrength * fxFront * (1.0 - fxFront) * 4.0 * (1.0 - fxEdge));
}
`;

function inject(source: string, anchor: string, code: string, position: "before" | "after"): string {
  if (!source.includes(anchor)) throw new Error(`Shader anchor not found: ${anchor}`);
  return source.replace(anchor, position === "after" ? `${anchor}\n${code}` : `${code}\n${anchor}`);
}

/** Patches a built-in three material (standard, basic...) with the reveal and edge fade. */
export function patchGroundFx(shader: WebGLProgramParametersWithUniforms, uniforms: GroundFxUniforms): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = inject(shader.vertexShader, "#include <common>", VERTEX_PARS, "after");
  shader.vertexShader = inject(shader.vertexShader, "#include <project_vertex>", VERTEX_MAIN, "after");
  shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_PARS, "after");
  shader.fragmentShader = inject(shader.fragmentShader, "#include <clipping_planes_fragment>", FRAGMENT_DISCARD, "after");
  shader.fragmentShader = inject(shader.fragmentShader, "#include <fog_fragment>", FRAGMENT_BLEND, "after");
}

export function applyGroundFx<T extends Material>(material: T, uniforms: GroundFxUniforms, cacheKey: string): T {
  material.onBeforeCompile = (shader) => patchGroundFx(shader, uniforms);
  // Same injected code for every material of this kind: share the program.
  material.customProgramCacheKey = () => `inmobilite-groundfx-${cacheKey}`;
  return material;
}
