"use client";

import { Text } from "@react-three/drei";
import { useMemo, useRef } from "react";
import { MeshBasicMaterial, type Mesh } from "three";
import type { AreaModel } from "@/domain/types";
import { LAYERS, PALETTE } from "../config/palette";
import { fontSizeFor, formatStreetName, uprightAngle } from "../geometry/labelLayout";
import { useDirectorFrame } from "../runtime/SceneRuntime";
import { useDisposeOnChange } from "../runtime/useDisposable";

/** Self-hosted (public/fonts) so troika never reaches for a CDN font. */
export const LABEL_FONT_URL = "/fonts/Geist-Regular.ttf";

const LABEL_OPACITY = 0.85;
/** Seconds for the showLabels toggle to fade. */
const TOGGLE_FADE = 0.35;

/** Troika's Text mesh exposes its render properties as plain fields. */
type TroikaText = Mesh & { fillOpacity: number };


/** Street names painted flat on the road surface, fading in at the end of the intro. */
export function StreetLabels({ area, show }: { area: AreaModel; show: boolean }) {
  const material = useMemo(
    () => new MeshBasicMaterial({ color: PALETTE.labelText, transparent: true, depthWrite: false, fog: false }),
    [],
  );
  useDisposeOnChange(material);
  const labels = useMemo(
    () =>
      area.labels.map((label) => ({
        key: `${label.name}:${label.position[0]}:${label.position[1]}`,
        text: formatStreetName(label.name),
        position: [label.position[0], LAYERS.label, -label.position[1]] as [number, number, number],
        rotation: [-Math.PI / 2, 0, uprightAngle(label.angle)] as [number, number, number],
        fontSize: fontSizeFor(label, area),
      })),
    [area],
  );

  const meshes = useRef<Array<TroikaText | null>>([]);
  const visibility = useRef(show ? 1 : 0);
  const lastT = useRef(0);

  useDirectorFrame((frame) => {
    const dt = Math.min(Math.max(frame.t - lastT.current, 0), 0.1);
    lastT.current = frame.t;
    const target = show ? 1 : 0;
    visibility.current += (target - visibility.current) * (1 - Math.exp((-dt * 3) / TOGGLE_FADE));
    const opacity = LABEL_OPACITY * frame.labels * visibility.current;
    for (const mesh of meshes.current) {
      if (!mesh) continue;
      mesh.fillOpacity = opacity;
      mesh.visible = opacity > 0.002;
    }
  });

  return (
    <group name="street-labels">
      {labels.map((label, i) => (
        <Text
          key={label.key}
          ref={(m: TroikaText | null) => {
            meshes.current[i] = m;
          }}
          font={LABEL_FONT_URL}
          material={material}
          position={label.position}
          rotation={label.rotation}
          fontSize={label.fontSize}
          letterSpacing={0.14}
          anchorX="center"
          anchorY="middle"
          depthOffset={-1}
          visible={false}
          raycast={() => null}
        >
          {label.text}
        </Text>
      ))}
    </group>
  );
}
