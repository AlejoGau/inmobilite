import type { AreaModel, StreetLabel } from "@/domain/types";

/** "Avenida Rivadavia" → "AV. RIVADAVIA": the way street names are painted on Buenos Aires maps. */
export function formatStreetName(name: string): string {
  return name.replace(/^avenida\s+/i, "Av. ").toLocaleUpperCase("es-AR");
}

/** Folds an angle into (-90°, 90°], so flat text reads left to right for a camera looking roughly north. */
export function uprightAngle(angle: number): number {
  let a = Math.atan2(Math.sin(angle), Math.cos(angle));
  if (a > Math.PI / 2) a -= Math.PI;
  if (a <= -Math.PI / 2) a += Math.PI;
  return a;
}

/** Letter height in meters, scaled with the carriageway so avenue names read bigger. */
export function fontSizeFor(label: StreetLabel, area: AreaModel): number {
  const road = area.roads.find((r) => r.name === label.name);
  const width = road?.width ?? 8;
  return Math.min(3.2, Math.max(1.8, width * 0.2));
}
