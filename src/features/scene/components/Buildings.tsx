"use client";

import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Mesh } from "three";
import type { AreaModel, Building } from "@/domain/types";
import { buildBuildingGeometry, type BuildingMeshData } from "../geometry/buildingGeometry";
import { createBuildingMaterial, type BuildingMaterial } from "../materials/buildingMaterial";
import { useDirectorFrame, useSceneRuntime } from "../runtime/SceneRuntime";
import { useDisposable } from "../runtime/useDisposable";
import { SelectionTag } from "./SelectionTag";

/** Pointer travel (px) above which a press is a drag (orbiting), not a click. */
const CLICK_TOLERANCE = 6;
/** How fast the hover / selection highlight follows its target, per second. */
const HIGHLIGHT_RATE = 10;
const HOVER_LEVEL = 0.55;

interface BuildingPart {
  building: Building;
  mesh: BuildingMeshData;
  material: BuildingMaterial;
}

export interface BuildingsProps {
  area: AreaModel;
  selectedBuildingId: string | null;
  onSelectBuilding: (building: Building | null) => void;
}

/**
 * The modelled buildings (at most 20): one mesh each, so hover and click are
 * a plain raycast. They rise from the corner outwards, scaled in Y by the
 * director, with a light line riding on top while they grow.
 */
export function Buildings({ area, selectedBuildingId, onSelectBuilding }: BuildingsProps) {
  const { director, exploring } = useSceneRuntime();
  const gl = useThree((s) => s.gl);

  const parts = useDisposable(() => {
    const list: BuildingPart[] = area.buildings.map((building) => {
      const mesh = buildBuildingGeometry(building);
      return { building, mesh, material: createBuildingMaterial(building, mesh) };
    });
    return Object.assign(list, {
      dispose() {
        for (const p of list) {
          p.mesh.geometry.dispose();
          p.material.material.dispose();
        }
      },
    });
  }, [area]);

  const meshes = useRef<Array<Mesh | null>>([]);
  const hovered = useRef<string | null>(null);
  const highlight = useMemo(() => new Float64Array(parts.length), [parts]);
  const lastT = useRef(0);
  const selected = useRef(selectedBuildingId);
  useEffect(() => {
    selected.current = selectedBuildingId;
  }, [selectedBuildingId]);

  // A replay starts with no hover and the default cursor.
  useEffect(() => {
    if (exploring) return;
    hovered.current = null;
    gl.domElement.style.cursor = "";
  }, [exploring, gl]);

  useDirectorFrame((frame) => {
    const dt = Math.min(Math.max(frame.t - lastT.current, 0), 0.1);
    lastT.current = frame.t;
    const follow = 1 - Math.exp(-dt * HIGHLIGHT_RATE);
    parts.forEach((part, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      const rise = director.buildingRise(i, frame);
      const linear = director.buildingRiseLinear(i, frame);
      mesh.visible = linear > 0;
      mesh.scale.y = Math.max(rise, 1e-3);
      const u = part.material.uniforms;
      u.uScaleY.value = mesh.scale.y;
      // Brightest as the building starts to grow, gone once it has settled.
      u.uEdgeGlow.value = linear > 0 && linear < 1 ? Math.pow(1 - linear, 1.4) * Math.min(1, linear * 25) : 0;
      const id = part.building.id;
      const target = id === selected.current ? 1 : id === hovered.current ? HOVER_LEVEL : 0;
      highlight[i] += (target - highlight[i]) * follow;
      u.uHighlight.value = highlight[i];
    });
  });

  const handlers = (building: Building) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (!exploring) return;
      e.stopPropagation();
      hovered.current = building.id;
      gl.domElement.style.cursor = "pointer";
    },
    onPointerOut: () => {
      if (hovered.current !== building.id) return;
      hovered.current = null;
      gl.domElement.style.cursor = "";
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!exploring || e.delta > CLICK_TOLERANCE) return;
      e.stopPropagation();
      onSelectBuilding(building);
    },
  });

  const selectedPart = parts.find((p) => p.building.id === selectedBuildingId) ?? null;

  return (
    <group name="buildings">
      {parts.map((part, i) => (
        <mesh
          key={part.building.id}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={part.mesh.geometry}
          material={part.material.material}
          castShadow
          receiveShadow
          visible={false}
          {...handlers(part.building)}
        />
      ))}
      {exploring && selectedPart && <SelectionTag building={selectedPart.building} mesh={selectedPart.mesh} />}
    </group>
  );
}
