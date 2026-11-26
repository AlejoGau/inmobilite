"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { TextureLoader, type Color, type Mesh, type Texture } from "three";
import type { Building, FacadePhoto as FacadePhotoData } from "@/domain/types";
import { buildFacadeGeometry, frontWallHeight } from "../geometry/facadeGeometry";
import { averagePhotoColour, createFacadeMaterial } from "../materials/facadeMaterial";
import { disposableGroup, useDisposeOnChange } from "../runtime/useDisposable";

interface LoadedPhoto {
  texture: Texture;
  aspect: number;
  /** Average colour of the facade, or null when the image could not be read. */
  colour: Color | null;
}

export interface FacadePhotoProps {
  building: Building;
  facade: FacadePhotoData;
  /** Hands the mesh to Buildings, which rises and highlights it with its building (no clock of its own). */
  register: (mesh: Mesh | null) => void;
  /** The photo's average colour, once it has loaded, to tint the building's clay. */
  onColour: (colour: Color) => void;
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut: () => void;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}

/**
 * The real street-level photo on a featured building's front wall. Loaded
 * imperatively: a failed photo (the GCBA service down, a parcel without one)
 * simply draws nothing, without suspending or erroring the scene.
 */
export function FacadePhoto({ building, facade, register, onColour, ...handlers }: FacadePhotoProps) {
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new TextureLoader();
    // The GCBA serves the photos with CORS *: anonymous keeps the canvas readable for the colour sample.
    loader.setCrossOrigin("anonymous");
    loader.load(
      facade.url,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        const image = texture.image as HTMLImageElement;
        setPhoto({ texture, aspect: image.width / Math.max(image.height, 1), colour: averagePhotoColour(image) });
      },
      undefined,
      () => {
        // No photo, no quad: the clay facade is still a complete building.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [facade.url]);

  // Also re-applied when the parent rebuilds its materials (a new area with the same photo).
  useEffect(() => {
    if (photo?.colour) onColour(photo.colour);
  }, [photo, onColour]);

  const resources = useMemo(() => {
    if (!photo) return null;
    const geometry = buildFacadeGeometry(facade.front, frontWallHeight(building, facade.front), photo.aspect);
    return disposableGroup({ geometry, material: createFacadeMaterial(photo.texture), texture: photo.texture });
  }, [photo, building, facade.front]);
  useDisposeOnChange(resources);

  if (!resources) return null;
  return (
    <mesh
      ref={register}
      geometry={resources.geometry}
      material={resources.material}
      receiveShadow
      // Starts hidden; Buildings shows it with its building's rise.
      visible={false}
      {...handlers}
    />
  );
}
