import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PALETTE } from "../config/palette";

/** Shape of the base tree (scale 1), in meters. Typical Buenos Aires street tree, simplified. */
export const TREE_SHAPE = {
  trunkHeight: 2.8,
  trunkRadius: 0.16,
  crownRadius: 2.3,
  crownCentre: 4.6,
  secondCrownRadius: 1.55,
  secondCrownOffset: [0.95, 5.9, -0.55] as const,
} as const;

function paint(geometry: BufferGeometry, hex: string): BufferGeometry {
  const colour = new Color(hex);
  const count = geometry.getAttribute("position").count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colour.toArray(data, i * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(data, 3));
  return geometry;
}

/**
 * Low-poly tree: a tapered trunk and a two-blob crown, merged into one
 * geometry with vertex colours so a single InstancedMesh draws them all.
 * The base sits at y = 0.
 */
export function buildTreeGeometry(): BufferGeometry {
  const s = TREE_SHAPE;
  const trunk = new CylinderGeometry(s.trunkRadius * 0.75, s.trunkRadius, s.trunkHeight, 6, 1).toNonIndexed();
  trunk.translate(0, s.trunkHeight / 2, 0);
  const crown = new IcosahedronGeometry(s.crownRadius, 1);
  crown.scale(1, 0.9, 1);
  crown.translate(0, s.crownCentre, 0);
  const secondCrown = new IcosahedronGeometry(s.secondCrownRadius, 1);
  secondCrown.translate(s.secondCrownOffset[0], s.secondCrownOffset[1], s.secondCrownOffset[2]);

  const parts = [paint(trunk, PALETTE.treeTrunk), paint(crown, PALETTE.treeCrown), paint(secondCrown, PALETTE.treeCrown)];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error("Tree parts have incompatible attributes");
  merged.computeBoundingSphere();
  return merged;
}
