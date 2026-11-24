"use client";

import { useMemo, useRef } from "react";
import { CylinderGeometry, PlaneGeometry, type Group } from "three";
import { LAYERS } from "../config/palette";
import { BEACON_SPEC, createBeaconUniforms, createColumnMaterial, createRingsMaterial } from "../materials/beaconMaterials";
import { useDirectorFrame } from "../runtime/SceneRuntime";
import { useDisposable } from "../runtime/useDisposable";

/** Teal light column and pulsing rings marking the searched corner. */
export function Beacon() {
  const uniforms = useMemo(() => createBeaconUniforms(), []);
  const group = useRef<Group>(null);

  const geometry = useDisposable(() => {
    const s = BEACON_SPEC;
    const column = new CylinderGeometry(s.columnRadius, s.columnRadius, s.columnHeight, 32, 1, true);
    column.translate(0, s.columnHeight / 2, 0);
    const core = new CylinderGeometry(s.coreRadius, s.coreRadius, s.columnHeight, 16, 1, true);
    core.translate(0, s.columnHeight / 2, 0);
    const rings = new PlaneGeometry(s.groundExtent * 2, s.groundExtent * 2);
    // Laid flat; the rings shader reads the ground-plane coordinates (x, z).
    rings.rotateX(-Math.PI / 2);
    return Object.assign([column, core, rings], { column, core, rings });
  }, []);

  const materials = useDisposable(
    () => {
      const glow = createColumnMaterial(uniforms, 0.55);
      const core = createColumnMaterial(uniforms, 1.6);
      const rings = createRingsMaterial(uniforms);
      return Object.assign([glow, core, rings], { glow, core, rings });
    },
    [uniforms],
  );

  useDirectorFrame((frame) => {
    uniforms.uIntensity.value = frame.beacon;
    uniforms.uTime.value = frame.t;
    if (group.current) group.current.visible = frame.beacon > 0.001;
  });

  return (
    <group ref={group} name="beacon" visible={false}>
      <mesh geometry={geometry.column} material={materials.glow} renderOrder={10} raycast={() => null} />
      <mesh geometry={geometry.core} material={materials.core} renderOrder={11} raycast={() => null} />
      <mesh geometry={geometry.rings} material={materials.rings} position={[0, LAYERS.beacon, 0]} renderOrder={9} raycast={() => null} />
    </group>
  );
}
