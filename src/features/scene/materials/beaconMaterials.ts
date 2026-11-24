import { AdditiveBlending, Color, ShaderMaterial } from "three";
import { PALETTE } from "../config/palette";

/** Beacon at the searched corner. Everything is a pure function of the director's t. */
export const BEACON_SPEC = {
  columnHeight: 70,
  columnRadius: 0.55,
  coreRadius: 0.14,
  pulsePeriod: 2.6,
  ringMinRadius: 2.5,
  ringMaxRadius: 15,
  /** Half size of the ground quad that draws the rings. */
  groundExtent: 17,
} as const;

export interface BeaconUniforms {
  uIntensity: { value: number };
  uTime: { value: number };
  uColor: { value: Color };
}

export function createBeaconUniforms(): BeaconUniforms {
  return { uIntensity: { value: 0 }, uTime: { value: 0 }, uColor: { value: new Color(PALETTE.accent) } };
}

/**
 * Light column: fades with height and towards its silhouette (a soft beam,
 * not a solid tube); HDR at the foot, so bloom picks it up.
 */
export function createColumnMaterial(uniforms: BeaconUniforms, strength: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...uniforms, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying float vHeight;
      varying float vFacing;
      void main() {
        vHeight = clamp(position.y / ${BEACON_SPEC.columnHeight.toFixed(1)}, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uStrength;
      varying float vHeight;
      varying float vFacing;
      void main() {
        float fade = pow(1.0 - vHeight, 1.8);
        float soft = pow(vFacing, 1.6);
        float foot = 1.0 + 2.5 * pow(1.0 - vHeight, 10.0);
        float a = fade * soft * uIntensity * uStrength;
        gl_FragColor = vec4(uColor * foot * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/** Two concentric rings expanding from the corner, plus a soft glow pool at the foot of the column. */
export function createRingsMaterial(uniforms: BeaconUniforms): ShaderMaterial {
  const s = BEACON_SPEC;
  return new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      varying vec2 vLocal;
      float ring(float r, float phase) {
        float radius = mix(${s.ringMinRadius.toFixed(2)}, ${s.ringMaxRadius.toFixed(2)}, phase);
        float width = mix(0.18, 0.55, phase);
        float aa = fwidth(r);
        float line = 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, abs(r - radius));
        // Ease out the fade so the ring is strongest just after it is born.
        return line * pow(1.0 - phase, 2.0) * smoothstep(0.0, 0.08, phase);
      }
      void main() {
        float r = length(vLocal);
        float phase = fract(uTime / ${s.pulsePeriod.toFixed(2)});
        float rings = ring(r, phase) + ring(r, fract(phase + 0.5));
        float pool = exp(-r * r / 6.0) * 0.55;
        float a = (rings * 1.4 + pool) * uIntensity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}
