import { test } from "vitest";
import { buildArea } from "@/domain/area/buildArea";
import fixture from "@/domain/__fixtures__/acoyte-rivadavia.overpass.json";
import type { OverpassResponse } from "@/domain/osm/overpass";
import difference from "@turf/difference";
import { featureCollection, polygon } from "@turf/helpers";

test("bench", () => {
  let t0 = performance.now();
  const m = buildArea({ origin: { lat: -34.6183, lng: -58.43646 }, osm: fixture as OverpassResponse, radius: 300 });
  console.log("buildArea ms", performance.now() - t0, "roads", m.roads.length, "trees", m.trees.length, "buildings", m.buildings.length);
  const cls: Record<string, number> = {};
  for (const r of m.roads) cls[r.cls] = (cls[r.cls] ?? 0) + 1;
  console.log(cls, m.roads.reduce((s, r) => s + r.points.length, 0));
  const polys: [number, number][][][] = [];
  for (const r of m.roads) {
    if (r.cls === "footway" || r.cls === "pedestrian") continue;
    const hw = r.width / 2;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [ax, ay] = r.points[i], [bx, by] = r.points[i + 1];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L * hw, ny = dx / L * hw;
      polys.push([[[ax + nx, ay + ny], [ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny], [ax + nx, ay + ny]]]);
    }
    for (let i = 1; i + 1 < r.points.length; i++) {
      const [cx, cy] = r.points[i]; const ring: [number, number][] = [];
      for (let k = 0; k < 8; k++) ring.push([cx + Math.cos(k * Math.PI / 4) * hw, cy + Math.sin(k * Math.PI / 4) * hw]);
      ring.push(ring[0]); polys.push([ring]);
    }
  }
  const disc: [number, number][] = [];
  for (let k = 0; k < 96; k++) disc.push([Math.cos(k / 96 * 2 * Math.PI) * 330, Math.sin(k / 96 * 2 * Math.PI) * 330]);
  disc.push(disc[0]);
  t0 = performance.now();
  const res = difference(featureCollection([polygon([disc]), ...polys.map((p) => polygon(p))]));
  console.log("difference ms", performance.now() - t0, "polys", polys.length, res?.geometry.type, res?.geometry.type === "MultiPolygon" ? res.geometry.coordinates.length : 1);
  console.log(JSON.stringify(m.labels).slice(0, 400));
  console.log(m.buildings.slice(0, 3).map((b) => JSON.stringify(b).slice(0, 300)).join("\n"));
});
