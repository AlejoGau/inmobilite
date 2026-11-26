import type { AreaModel, Building, Road, Ring } from "@/domain/types";

/** Axis-aligned rectangle footprint, CCW. */
export function rect(x0: number, y0: number, x1: number, y1: number): Ring {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function building(id: string, footprint: Ring, height: number, levels: number, distance: number, use: Building["use"] = "residential"): Building {
  return {
    id,
    footprint,
    parts: [{ footprint, height }],
    height,
    levels,
    heightSource: "estimated",
    use,
    area: 100,
    distance,
    seed: 1000 + distance * 13,
  };
}

/**
 * A GCBA-style building: a 3-storey podium on the street front and a
 * 75 m tower behind it, side by side (they share the wall at y = 32),
 * plus a machine room poking out of the tower roof.
 */
export function podiumAndTower(id = "b5", distance = 60): Building {
  const podium = rect(-80, 20, -50, 32);
  // The machine room sits on the tower's back edge; the tower ring wraps it on three sides, so the parts tile the lot as in the GCBA model.
  const machineRoom = rect(-68, 46, -62, 52);
  const towerRing: Ring = [
    [-80, 32],
    [-50, 32],
    [-50, 52],
    [-62, 52],
    [-62, 46],
    [-68, 46],
    [-68, 52],
    [-80, 52],
  ];
  return {
    id,
    footprint: rect(-80, 20, -50, 52),
    parts: [
      { footprint: podium, height: 8.4 },
      { footprint: towerRing, height: 75.6 },
      { footprint: machineRoom, height: 78.4 },
    ],
    height: 78.4,
    levels: 27,
    heightSource: "gcba",
    smp: "040-088-010",
    use: "residential",
    area: 960,
    distance,
    seed: 4242,
  };
}

/**
 * A small synthetic corner: an avenue crossing a street at the origin, a
 * side street, four buildings and a park. Hand-made so the scene tests do
 * not depend on the domain builder.
 */
export function sampleArea(): AreaModel {
  const roads: Road[] = [
    { id: "av", name: "Avenida Rivadavia", cls: "primary", width: 18, points: [[-200, 0], [0, 0], [200, 0]] },
    { id: "st-n", name: "Avenida Acoyte", cls: "secondary", width: 13, points: [[0, 0], [0, 200]] },
    { id: "st-s", name: "Avenida Acoyte", cls: "secondary", width: 13, points: [[0, -200], [0, 0]] },
    { id: "side", name: "Rosario", cls: "residential", width: 8, points: [[-200, -90], [200, -90]] },
    { id: "walk", cls: "footway", width: 2.2, points: [[40, 40], [80, 80]] },
  ];
  return {
    origin: { lat: -34.6183, lng: -58.43646 },
    radius: 300,
    seed: 123456,
    roads,
    buildings: [
      building("b1", rect(15, 15, 35, 40), 30, 10, 25, "commercial"),
      building("b2", rect(-40, 15, -15, 35), 12, 4, 30),
      building("b3", rect(-40, -45, -15, -15), 4.2, 1, 38, "commercial"),
      building("b4", rect(20, -60, 45, -20), 45, 15, 50),
      podiumAndTower(),
    ],
    parks: [{ id: "p1", polygon: rect(60, 20, 120, 80) }],
    trees: [
      { position: [12, 30], scale: 1 },
      { position: [-12, 60], scale: 0.8 },
      { position: [100, 50], scale: 1.2 },
    ],
    labels: [{ name: "Avenida Rivadavia", position: [-30, 0], angle: 0 }],
    stats: { buildings: 5, estimatedHeights: 4, streets: ["Avenida Rivadavia", "Avenida Acoyte", "Rosario"] },
    attribution: "© OpenStreetMap contributors",
  };
}
