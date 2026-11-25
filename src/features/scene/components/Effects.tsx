"use client";

import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { QualityTier } from "../runtime/SceneRuntime";

/**
 * Post stack. AO is what sells the maquette (contact shadows at every kerb,
 * corner and roof); bloom only catches the HDR windows and the beacon thanks
 * to a high threshold; AgX keeps the warm clay from turning orange.
 * The composer disables the renderer's own tone mapping, so it lives here.
 */
/** Linear HDR luminance. Sunlit clay peaks just below it; lit windows and the beacon go above. */
export const BLOOM_THRESHOLD = 1.5;

export function Effects({ quality }: { quality: QualityTier }) {
  const high = quality === "high";
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {high ? <N8AO aoRadius={3.2} distanceFalloff={1.2} intensity={2.1} quality="medium" halfRes depthAwareUpsampling color="#06080c" /> : null}
      <Bloom luminanceThreshold={BLOOM_THRESHOLD} luminanceSmoothing={0.25} intensity={0.7} mipmapBlur radius={0.7} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.28} darkness={0.55} eskil={false} />
      <SMAA />
    </EffectComposer>
  );
}
