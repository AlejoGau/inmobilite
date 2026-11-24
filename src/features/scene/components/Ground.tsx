"use client";

import { useMemo } from "react";
import { MeshStandardMaterial } from "three";
import type { AreaModel } from "@/domain/types";
import { LAYERS, PALETTE } from "../config/palette";
import { buildDiscGeometry, buildFallbackRoadGeometry, buildKerbGeometry, buildParkGeometry, buildPolygonsTopGeometry } from "../geometry/groundGeometry";
import { groundPlanFor } from "../geometry/groundPlan";
import { buildMarkingsGeometry } from "../geometry/markings";
import { applyGroundFx, createGroundFxUniforms, type GroundFxUniforms } from "../materials/groundFx";
import { useDirectorFrame } from "../runtime/SceneRuntime";
import { useDisposable } from "../runtime/useDisposable";

/** Width of the soft band at each reveal front, in meters. */
const REVEAL_SOFTNESS = 28;

function fxFor(area: AreaModel, frontStrength: number): GroundFxUniforms {
  return createGroundFxUniforms({
    fadeStart: area.radius * 0.6,
    fadeEnd: area.radius,
    background: PALETTE.background,
    frontColor: PALETTE.accent,
    frontStrength,
    softness: REVEAL_SOFTNESS,
  });
}

function standard(color: string, roughness: number, fx: GroundFxUniforms, key: string, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color, roughness, metalness: 0 });
  Object.assign(material, extra);
  return applyGroundFx(material, fx, key);
}

/**
 * The maquette base: an asphalt disc, block plinths at kerb height carved by
 * the streets, a darker lot inside each sidewalk band, raised lawns and the
 * lane paint. Each layer grows radially from the corner, driven by the
 * director (ground first, then the plinths, then the paint).
 */
export function Ground({ area }: { area: AreaModel }) {
  const plan = useMemo(() => groundPlanFor(area), [area]);
  const fx = useMemo(
    () => ({ asphalt: fxFor(area, 0.35), plinth: fxFor(area, 0.18), paint: fxFor(area, 0) }),
    [area],
  );

  const geometry = useDisposable(() => {
    const blocks = plan.blocks;
    return {
      asphalt: buildDiscGeometry(plan.discRadius, blocks ? LAYERS.asphalt : 0),
      // With the booleans failed, the asphalt becomes ribbons and the base turns into a flat lot.
      fallbackRoads: blocks ? null : buildFallbackRoadGeometry(plan),
      blocks: blocks ? buildPolygonsTopGeometry(blocks, LAYERS.sidewalk) : null,
      kerbs: blocks ? buildKerbGeometry(blocks, plan.discRadius) : null,
      lots: plan.lots ? buildPolygonsTopGeometry(plan.lots, LAYERS.lot) : null,
      parks: buildParkGeometry(plan.parks),
      markings: buildMarkingsGeometry(plan.network),
      dispose() {
        for (const g of [this.asphalt, this.fallbackRoads, this.blocks, this.kerbs, this.lots, this.parks, this.markings]) g?.dispose();
      },
    };
  }, [plan]);

  const materials = useDisposable(() => {
    const paintOffset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
    return {
      asphalt: standard(plan.blocks ? PALETTE.asphalt : PALETTE.lot, 0.94, fx.asphalt, "asphalt"),
      fallbackRoads: standard(PALETTE.asphalt, 0.94, fx.plinth, "fallback-roads", paintOffset),
      sidewalk: standard(PALETTE.sidewalk, 0.9, fx.plinth, "sidewalk"),
      lot: standard(PALETTE.lot, 0.95, fx.plinth, "lot"),
      kerb: standard(PALETTE.kerb, 0.8, fx.plinth, "kerb"),
      park: standard(PALETTE.park, 0.97, fx.plinth, "park"),
      paint: standard("#ffffff", 0.7, fx.paint, "paint", { vertexColors: true, ...paintOffset }),
      dispose() {
        for (const m of [this.asphalt, this.fallbackRoads, this.sidewalk, this.lot, this.kerb, this.park, this.paint]) m.dispose();
      },
    };
  }, [plan, fx]);

  const maxRadius = plan.discRadius * 1.05 + REVEAL_SOFTNESS;
  useDirectorFrame((frame) => {
    fx.asphalt.uRevealRadius.value = frame.groundReveal * maxRadius;
    fx.plinth.uRevealRadius.value = frame.roadsReveal * maxRadius;
    fx.paint.uRevealRadius.value = frame.markingsReveal * maxRadius;
  });

  return (
    <group name="ground">
      <mesh geometry={geometry.asphalt} material={materials.asphalt} receiveShadow />
      {geometry.fallbackRoads && <mesh geometry={geometry.fallbackRoads} material={materials.fallbackRoads} receiveShadow />}
      {geometry.blocks && <mesh geometry={geometry.blocks} material={materials.sidewalk} receiveShadow />}
      {geometry.kerbs && <mesh geometry={geometry.kerbs} material={materials.kerb} castShadow receiveShadow />}
      {geometry.lots && <mesh geometry={geometry.lots} material={materials.lot} receiveShadow />}
      <mesh geometry={geometry.parks} material={materials.park} receiveShadow />
      <mesh geometry={geometry.markings} material={materials.paint} receiveShadow />
    </group>
  );
}
