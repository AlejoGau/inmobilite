"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from "three";
import { mulberry32, randomBetween } from "@/domain/seed";
import type { AreaModel } from "@/domain/types";
import { LAYERS, PALETTE } from "../config/palette";
import { buildTreeGeometry } from "../geometry/treeGeometry";
import { applyGroundFx, createGroundFxUniforms } from "../materials/groundFx";
import { useDirectorFrame, useSceneRuntime } from "../runtime/SceneRuntime";
import { useDisposeOnChange } from "../runtime/useDisposable";

interface TreeLayout {
  x: number;
  z: number;
  scale: number;
  rotation: number;
}

/** Trees never block clicks on buildings, and 600 instances are not worth raycasting. */
function noRaycast(): void {}

/**
 * Every tree in one InstancedMesh. Instance matrices are rewritten only while
 * the pop-in animates (the reveal value changes); afterwards they are static.
 */
export function Trees({ area }: { area: AreaModel }) {
  const { director } = useSceneRuntime();
  const mesh = useRef<InstancedMesh>(null);

  const layout = useMemo<TreeLayout[]>(() => {
    const rng = mulberry32(area.seed ^ 0x3c6ef372);
    return area.trees.map((tree) => ({
      x: tree.position[0],
      z: -tree.position[1],
      scale: tree.scale,
      rotation: randomBetween(rng, 0, Math.PI * 2),
    }));
  }, [area]);

  const geometry = useMemo(() => buildTreeGeometry(), []);
  useDisposeOnChange(geometry);
  const fx = useMemo(() => {
    const uniforms = createGroundFxUniforms({
      fadeStart: area.radius * 0.6,
      fadeEnd: area.radius,
      background: PALETTE.background,
      frontColor: PALETTE.accent,
      frontStrength: 0,
      softness: 1,
    });
    // Trees only use the edge fade; they appear through their own pop, not a radial reveal.
    uniforms.uRevealRadius.value = 1e6;
    return uniforms;
  }, [area]);
  const material = useMemo(
    () => applyGroundFx(new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), fx, "trees"),
    [fx],
  );
  useDisposeOnChange(material);

  // Seeded per-instance tint: some greener, some yellower, some darker.
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const rng = mulberry32(area.seed ^ 0x7f4a7c15);
    const colour = new Color();
    const white = new Color(1, 1, 1);
    for (let i = 0; i < layout.length; i++) {
      colour.setHSL(randomBetween(rng, 0.06, 0.3), randomBetween(rng, 0.1, 0.35), 0.5).offsetHSL(0, 0, randomBetween(rng, -0.08, 0.06));
      // A neutral base keeps the vertex colours (trunk brown, crown green) in charge.
      colour.lerp(white, 0.7);
      m.setColorAt(i, colour);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [area, layout]);

  const scratch = useMemo(() => ({ matrix: new Matrix4(), scale: new Vector3() }), []);
  const lastReveal = useRef(-1);

  useDirectorFrame((frame) => {
    const m = mesh.current;
    if (!m) return;
    if (frame.treesReveal === lastReveal.current) return;
    lastReveal.current = frame.treesReveal;
    const { matrix, scale } = scratch;
    for (let i = 0; i < layout.length; i++) {
      const tree = layout[i];
      const s = Math.max(director.treePop(i, frame) * tree.scale, 1e-4);
      matrix.makeRotationY(tree.rotation);
      matrix.scale(scale.set(s, s, s));
      matrix.setPosition(tree.x, LAYERS.sidewalk, tree.z);
      m.setMatrixAt(i, matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  if (layout.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, layout.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
}
