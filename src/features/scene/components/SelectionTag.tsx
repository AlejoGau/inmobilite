"use client";

import { Html } from "@react-three/drei";
import type { CSSProperties } from "react";
import type { Building, HeightSource } from "@/domain/types";
import type { BuildingMeshData } from "../geometry/buildingGeometry";

const card: CSSProperties = {
  transform: "translate3d(-50%, calc(-100% - 10px), 0)",
  padding: "8px 12px",
  borderRadius: 10,
  background: "var(--color-surface, rgba(16, 21, 30, 0.82))",
  color: "var(--color-foreground, #f3f5f7)",
  border: "1px solid var(--color-border, rgba(255, 255, 255, 0.14))",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
  font: "500 13px/1.35 var(--font-sans, system-ui, sans-serif)",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  userSelect: "none",
};

const muted: CSSProperties = { opacity: 0.7, fontWeight: 400, fontSize: 12 };

const accentDot: CSSProperties = {
  display: "inline-block",
  width: 6,
  height: 6,
  marginRight: 6,
  borderRadius: 999,
  background: "var(--color-accent, #14b8a6)",
  verticalAlign: "middle",
};

export function levelsLabel(levels: number): string {
  return levels === 1 ? "1 piso" : `${levels} pisos`;
}

/** How much to trust the height: measured by the city, or guessed. OSM heights need no caveat. */
export function heightSourceLabel(source: HeightSource): string | null {
  switch (source) {
    case "gcba":
      return "altura medida (GCBA)";
    case "estimated":
      return "altura estimada";
    case "osm":
      return null;
  }
}

/** Gap between the top of the tallest part and the tag, m. */
const TAG_LIFT = 3;

/** Minimal tag above the tallest part of the selected building: name, levels, height and where the height comes from. */
export function SelectionTag({ building, mesh }: { building: Building; mesh: BuildingMeshData }) {
  const [x, y, z] = mesh.tagAnchor;
  const source = heightSourceLabel(building.heightSource);
  return (
    <Html position={[x, y + TAG_LIFT, z]} zIndexRange={[20, 0]} pointerEvents="none">
      <div style={card} role="status" aria-live="polite">
        <div>
          <span style={accentDot} aria-hidden="true" />
          {building.name ?? "Edificio"}
        </div>
        <div style={muted}>
          {levelsLabel(building.levels)} · {Math.round(building.height)} m
          {source ? ` · ${source}` : ""}
        </div>
      </div>
    </Html>
  );
}
