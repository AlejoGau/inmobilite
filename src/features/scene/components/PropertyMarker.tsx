"use client";

/* eslint-disable react-hooks/immutability -- three.js objects (materials, meshes) are mutated imperatively outside render, by design. */

import { useMemo, useRef } from "react";
import { AdditiveBlending, MeshBasicMaterial, type Mesh } from "three";
import { propertyFront } from "@/domain/area/facade";
import type { AreaModel, Vec2 } from "@/domain/types";
import { LAYERS, PALETTE } from "../config/palette";
import { buildRibbonGeometry } from "../geometry/ribbon";
import { useDirectorFrame } from "../runtime/SceneRuntime";
import { disposableGroup, useDisposeOnChange } from "../runtime/useDisposable";

export const PROPERTY_MARKER_SPEC = {
  /** Out from the wall onto the sidewalk, so it reads as "this frontage" and not as part of the facade. */
  offset: 0.55,
  halfWidth: 0.16,
  /** Pulled in at both ends, so the line stops short of the neighbours' party walls. */
  inset: 0.5,
  /** Just above the kerb top, below anything that stands on it. */
  lift: 0.012,
  opacity: 0.85,
} as const;

/**
 * A thin teal line on the sidewalk along the searched property's front: the
 * same accent as the corner beacon, quiet enough not to compete with the
 * photo above it. It fades in with the beacon, from the director's frame.
 */
export function PropertyMarker({ area }: { area: AreaModel }) {
  const mesh = useRef<Mesh>(null);

  const resources = useMemo(() => {
    const property = propertyFront(area);
    if (!property) return null;
    const { offset, inset, halfWidth, lift } = PROPERTY_MARKER_SPEC;
    const [a, b] = property.front;
    const [nx, ny] = property.normal;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= inset * 2) return null;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    const at = (p: Vec2, along: number): Vec2 => [p[0] + nx * offset + ux * along, p[1] + ny * offset + uy * along];
    const geometry = buildRibbonGeometry([at(a, inset), at(b, -inset)], halfWidth, LAYERS.sidewalk + lift);
    const material = new MeshBasicMaterial({
      color: PALETTE.accent,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return disposableGroup({ geometry, material });
  }, [area]);
  useDisposeOnChange(resources);

  useDirectorFrame((frame) => {
    if (!mesh.current || !resources) return;
    resources.material.opacity = frame.beacon * PROPERTY_MARKER_SPEC.opacity;
    mesh.current.visible = frame.beacon > 0.001;
  });

  if (!resources) return null;
  return <mesh ref={mesh} name="property-marker" geometry={resources.geometry} material={resources.material} visible={false} raycast={() => null} />;
}
