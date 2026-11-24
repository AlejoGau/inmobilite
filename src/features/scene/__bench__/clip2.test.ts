import { test } from "vitest";
import { buildArea } from "@/domain/area/buildArea";
import fixture from "@/domain/__fixtures__/acoyte-rivadavia.overpass.json";
import type { OverpassResponse } from "@/domain/osm/overpass";
import difference from "@turf/difference";
import { featureCollection, polygon } from "@turf/helpers";

function offset(pts: number[][], o: number) {
  const out: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let n0x = 0, n0y = 0, n1x = 0, n1y = 0;
    if (i > 0) { const dx = p[0] - a[0], dy = p[1] - a[1], L = Math.hypot(dx, dy); n0x = -dy / L; n0y = dx / L; }
    if (i < pts.length - 1) { const dx = b[0] - p[0], dy = b[1] - p[1], L = Math.hypot(dx, dy); n1x = -dy / L; n1y = dx / L; }
    if (i === 0) { n0x = n1x; n0y = n1y; } if (i === pts.length - 1) { n1x = n0x; n1y = n0y; }
    let mx = n0x + n1x, my = n0y + n1y; const ml = Math.hypot(mx, my); mx /= ml; my /= ml;
    const s = Math.min(2.5, 1 / Math.max(1e-3, mx * n0x + my * n0y));
    out.push([p[0] + mx * o * s, p[1] + my * o * s]);
  }
  return out;
}
test("bench2", () => {
  const m = buildArea({ origin: { lat: -34.6183, lng: -58.43646 }, osm: fixture as OverpassResponse, radius: 300 });
  const polys: number[][][][] = [];
  for (const r of m.roads) {
    if (r.cls === "footway" || r.cls === "pedestrian") continue;
    const l = offset(r.points, r.width / 2), rr = offset(r.points, -r.width / 2).reverse();
    const ring = [...l, ...rr, l[0]];
    polys.push([ring]);
  }
  const disc: number[][] = [];
  for (let k = 0; k < 96; k++) disc.push([Math.cos(k / 96 * 2 * Math.PI) * 330, Math.sin(k / 96 * 2 * Math.PI) * 330]);
  disc.push(disc[0]);
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    const res = difference(featureCollection([polygon([disc]), ...polys.map((p) => polygon(p as [number, number][][]))]));
    console.log("difference ms", performance.now() - t0, "polys", polys.length, res?.geometry.type === "MultiPolygon" ? res.geometry.coordinates.length : 1);
  }
});
