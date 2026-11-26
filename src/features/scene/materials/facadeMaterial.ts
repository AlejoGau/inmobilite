import { Color, MeshStandardMaterial, SRGBColorSpace, type Texture } from "three";
import { PALETTE } from "../config/palette";

export const FACADE_MATERIAL_SPEC = {
  /** A touch of self-light so a photo on a wall turned away from the low sun stays readable at dusk. */
  emissive: 0.2,
  /** Extra self-light at full hover / selection, tinted teal like the clay highlight. */
  highlightEmissive: 0.35,
  highlightTint: 0.55,
  /** How far the clay of a building with a photo moves toward the photo's average colour. */
  clayTint: 0.5,
} as const;

const WHITE = new Color(1, 1, 1);
const ACCENT = new Color(PALETTE.accent);

/**
 * Lit like the clay (dusk sun, shadows), in sRGB, so the photo sits in the
 * scene instead of glowing on top of it. Vertex alpha carries the top fade.
 */
export function createFacadeMaterial(texture: Texture): MeshStandardMaterial {
  texture.colorSpace = SRGBColorSpace;
  return new MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: WHITE,
    emissiveIntensity: FACADE_MATERIAL_SPEC.emissive,
    roughness: 0.9,
    metalness: 0,
    vertexColors: true,
    transparent: true,
  });
}

/** Hover / selection on the photo, following the building's own highlight (0..1). No allocations: runs every frame. */
export function setFacadeHighlight(material: MeshStandardMaterial, highlight: number): void {
  material.emissive.copy(WHITE).lerp(ACCENT, highlight * FACADE_MATERIAL_SPEC.highlightTint);
  material.emissiveIntensity = FACADE_MATERIAL_SPEC.emissive + highlight * FACADE_MATERIAL_SPEC.highlightEmissive;
}

/**
 * Average colour of the facade in the photo, to tint the building's clay so
 * the volume matches its front. The sky and the watermarked edges are left
 * out: only the lower, central part of the image is read. Null when the
 * canvas cannot be read (a tainted image, no 2D context).
 */
export function averagePhotoColour(image: CanvasImageSource & { width: number; height: number }): Color | null {
  if (typeof document === "undefined") return null;
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(image, image.width * 0.1, image.height * 0.3, image.width * 0.8, image.height * 0.65, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const count = data.length / 4;
    return new Color().setRGB(r / count / 255, g / count / 255, b / count / 255, SRGBColorSpace);
  } catch {
    return null;
  }
}
