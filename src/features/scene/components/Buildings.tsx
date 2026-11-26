"use client";

/* eslint-disable react-hooks/immutability -- three.js objects (uniforms, meshes, renderer) are mutated imperatively outside render, by design. */

import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Color, Mesh, MeshStandardMaterial } from "three";
import type { AreaModel, Building } from "@/domain/types";
import { buildBuildingGeometry, type BuildingMeshData } from "../geometry/buildingGeometry";
import { createBuildingMaterial, type BuildingMaterial } from "../materials/buildingMaterial";
import { FACADE_MATERIAL_SPEC, setFacadeHighlight } from "../materials/facadeMaterial";
import { useDirectorFrame, useSceneRuntime } from "../runtime/SceneRuntime";
import { FacadePhoto } from "./FacadePhoto";
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
  /** The clay colour before any photo tint, so a re-tint never compounds. */
  clay: Color;
}

export interface BuildingsProps {
  area: AreaModel;
  selectedBuildingId: string | null;
  onSelectBuilding: (building: Building | null) => void;
  /** Whether the click that ends the current press may select (see StageInteraction). */
  clickMaySelect: () => boolean;
}

/**
 * The modelled buildings (at most 20): one mesh each, with every part
 * (podium, tower, setbacks, rooftop volumes) merged into it, so a building is
 * one draw call, hovering or clicking any part is a plain raycast on its
 * building, and all its parts rise together. They rise from the corner
 * outwards, scaled in Y by the director, with a light line riding on top of
 * each part while they grow.
 */
export function Buildings({ area, selectedBuildingId, onSelectBuilding, clickMaySelect }: BuildingsProps) {
  const { director, exploring } = useSceneRuntime();
  const gl = useThree((s) => s.gl);

  const parts = useMemo(
    () =>
      area.buildings.map((building): BuildingPart => {
        const mesh = buildBuildingGeometry(building);
        const material = createBuildingMaterial(building);
        return { building, mesh, material, clay: material.material.color.clone() };
      }),
    [area],
  );
  useEffect(
    () => () => {
      for (const p of parts) {
        p.mesh.geometry.dispose();
        p.material.material.dispose();
      }
    },
    [parts],
  );

  const meshes = useRef<Array<Mesh | null>>([]);
  // Facade photos of the featured buildings, by building index; they rise and light up with their building.
  const facadeMeshes = useRef<Array<Mesh | null>>([]);
  const tintTowardPhoto = useCallback(
    (index: number, colour: Color) => {
      const part = parts[index];
      if (part) part.material.material.color.copy(part.clay).lerp(colour, FACADE_MATERIAL_SPEC.clayTint);
    },
    [parts],
  );
  // One stable callback per building: a new area (new materials) re-tints from the photo already loaded.
  const tintCallbacks = useMemo(() => parts.map((_, i) => (colour: Color) => tintTowardPhoto(i, colour)), [parts, tintTowardPhoto]);
  // The building under the pointer, tracked during the intro too: R3F reports
  // entering a mesh only once, so a hover that began mid-intro must already be
  // known at the hand-over. Only what it shows (cursor, highlight) waits for
  // exploration. A replay keeps it, as R3F keeps the building booked as hovered.
  const hovered = useRef<string | null>(null);
  const highlight = useMemo(() => new Float64Array(parts.length), [parts]);
  const lastT = useRef(0);

  // The hand-over shows the pointer cursor for a hover that began during the intro; a replay hides it.
  useEffect(() => {
    gl.domElement.style.cursor = exploring && hovered.current ? "pointer" : "";
  }, [exploring, gl]);

  useDirectorFrame((frame) => {
    const dt = Math.min(Math.max(frame.t - lastT.current, 0), 0.1);
    lastT.current = frame.t;
    const follow = 1 - Math.exp(-dt * HIGHLIGHT_RATE);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const mesh = meshes.current[i];
      if (!mesh) continue;
      const rise = director.buildingRise(i, frame);
      const linear = director.buildingRiseLinear(i, frame);
      mesh.visible = linear > 0;
      mesh.scale.y = Math.max(rise, 1e-3);
      const u = part.material.uniforms;
      u.uScaleY.value = mesh.scale.y;
      // Brightest as the building starts to grow, gone once it has settled.
      u.uEdgeGlow.value = linear > 0 && linear < 1 ? Math.pow(1 - linear, 1.4) * Math.min(1, linear * 25) : 0;
      const id = part.building.id;
      const target = id === selectedBuildingId ? 1 : exploring && id === hovered.current ? HOVER_LEVEL : 0;
      highlight[i] += (target - highlight[i]) * follow;
      u.uHighlight.value = highlight[i];
      const facade = facadeMeshes.current[i];
      if (facade) {
        facade.visible = mesh.visible;
        facade.scale.y = mesh.scale.y;
        setFacadeHighlight(facade.material as MeshStandardMaterial, highlight[i]);
      }
    }
  });

  const handlers = (building: Building) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      // Stopped even during the intro, so R3F books only the front building as hovered.
      e.stopPropagation();
      hovered.current = building.id;
      if (exploring) gl.domElement.style.cursor = "pointer";
    },
    onPointerOut: () => {
      if (hovered.current !== building.id) return;
      hovered.current = null;
      gl.domElement.style.cursor = "";
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!clickMaySelect() || e.delta > CLICK_TOLERANCE) return;
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
      {parts.map(
        (part, i) =>
          part.building.facade && (
            <FacadePhoto
              key={`facade:${part.building.id}`}
              building={part.building}
              facade={part.building.facade}
              register={(m) => {
                facadeMeshes.current[i] = m;
              }}
              onColour={tintCallbacks[i]}
              {...handlers(part.building)}
            />
          ),
      )}
      {exploring && selectedPart && <SelectionTag building={selectedPart.building} mesh={selectedPart.mesh} />}
    </group>
  );
}
