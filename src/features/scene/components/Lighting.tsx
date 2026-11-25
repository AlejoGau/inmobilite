"use client";

/* eslint-disable react-hooks/immutability -- three.js objects (uniforms, meshes, renderer) are mutated imperatively outside render, by design. */

import { Environment, Lightformer } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { DirectionalLight } from "three";
import type { AreaModel } from "@/domain/types";
import { PALETTE } from "../config/palette";
import { fitShadowFrustum, shadowPoints, SUN, sunDirection } from "../lighting/sun";
import { useSceneRuntime } from "../runtime/SceneRuntime";

const SHADOW_MAP_SIZE = { high: 2048, low: 1024 } as const;

/**
 * Light budget, in linear HDR: a sun-facing clay wall lands around 1.3-1.4,
 * just under the bloom threshold (see Effects), so only emissive windows and
 * the beacon bloom. Raise the sun and the facades start to glow.
 */
const SUN_INTENSITY = 1.6;

/**
 * Dusk lighting: a low warm key with soft PCF shadows fitted to the area, a
 * cool hemisphere fill, and a Lightformer environment (built in-scene, so it
 * needs no HDR download and works offline) for soft reflections on glass.
 */
export function Lighting({ area }: { area: AreaModel }) {
  const { quality, exploring } = useSceneRuntime();
  const gl = useThree((s) => s.gl);
  const light = useRef<DirectionalLight>(null);
  const sun = useMemo(() => sunDirection(), []);
  const frustum = useMemo(() => fitShadowFrustum(shadowPoints(area, sun), sun, [0, 0, 0], SUN.distance), [area, sun]);
  const mapSize = SHADOW_MAP_SIZE[quality];

  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    const camera = l.shadow.camera;
    camera.left = frustum.left;
    camera.right = frustum.right;
    camera.top = frustum.top;
    camera.bottom = frustum.bottom;
    camera.near = frustum.near;
    camera.far = frustum.far;
    camera.updateProjectionMatrix();
    if (l.shadow.mapSize.x !== mapSize) {
      l.shadow.mapSize.set(mapSize, mapSize);
      // A new size needs a new render target.
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
    gl.shadowMap.needsUpdate = true;
  }, [frustum, mapSize, gl]);

  // The scene is static once the intro is over: render the shadow map once instead of every frame.
  useEffect(() => {
    gl.shadowMap.autoUpdate = !exploring;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [exploring, quality, gl]);

  const position: [number, number, number] = [sun[0] * SUN.distance, sun[1] * SUN.distance, sun[2] * SUN.distance];

  return (
    <>
      <directionalLight
        ref={light}
        position={position}
        color={PALETTE.sunLight}
        intensity={SUN_INTENSITY}
        castShadow
        shadow-bias={-0.0004}
        shadow-normalBias={0.06}
        shadow-radius={quality === "high" ? 4 : 2}
      />
      <hemisphereLight args={[PALETTE.hemisphereSky, PALETTE.hemisphereGround, 0.55]} />
      <Environment frames={1} resolution={128} environmentIntensity={0.5}>
        {/* Warm glow on the horizon where the sun sets. */}
        <Lightformer form="rect" intensity={2.2} color="#ffb47d" scale={[60, 8, 1]} position={[sun[0] * 40, 4, sun[2] * 40]} target={[0, 0, 0]} />
        {/* Cool dusk sky overhead and on the opposite side. */}
        <Lightformer form="circle" intensity={0.9} color="#5d7298" scale={60} position={[0, 40, 0]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={0.5} color="#3b4a68" scale={[60, 14, 1]} position={[-sun[0] * 40, 8, -sun[2] * 40]} target={[0, 0, 0]} />
      </Environment>
    </>
  );
}
