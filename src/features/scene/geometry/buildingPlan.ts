import type { Building, Ring, Vec2 } from "@/domain/types";
import { partsOf } from "./buildingExtent";
import { cleanRing, distance, insetRing, normalize, signedArea, sub, withOrientation } from "./polygon2d";

/**
 * Planar analysis of a multi-part building, before any 3D is built: which
 * stretch of each wall is hidden by a neighbouring part, which parts are
 * rooftop volumes, where the parapets go, and how facade stretches on one
 * plane line up so the window grid runs across parts.
 *
 * Why: the parts of a building tile its lot side by side (a podium next to a
 * tower, a machine room next to the roof it pokes out of). Extruded naively,
 * every shared edge would carry two coincident walls and two parapets, which
 * flicker (z-fighting), double the triangles and draw ridges across roofs.
 */

export const PLAN_SPEC = {
  /** Parts lower than this are clamped up to it, so even a kiosk reads as a volume. */
  minHeight: 2.5,
  /** Two edges closer than this (m) to the same line count as one shared wall. GCBA vertices sit on a ~6 cm grid at z17. */
  sharedWallTolerance: 0.05,
  /** Vertices closer than this (m) to the line through their neighbours are dropped: photogrammetry noise. */
  simplifyTolerance: 0.05,
  /** Below this footprint area (m²) a part is too small for a facade of its own. */
  tinyArea: 20,
  /** A rooftop volume (machine room, tank, stair head) is at most this big, rises above everything it touches... */
  rooftopMaxArea: 60,
  /** ...and its neighbours hide its walls up to at most this far below its top (and at least half its height)... */
  rooftopExposure: 6.5,
  /** ...over at least this share of its perimeter. */
  rooftopCoveredShare: 0.6,
  /** Inset of the parapet from the facade, m. */
  parapetInset: 0.3,
  parapetLow: 0.6,
  parapetTall: 1.0,
  /** Storey height of the GCBA model: its heights come in 2.8 m steps. */
  gcbaFloorHeight: 2.8,
  /** Bounds of the storey height derived from height / levels for OSM or estimated buildings. */
  minFloorHeight: 2.7,
  maxFloorHeight: 4.2,
  /** Collinear facade stretches separated by at most this gap (m) share one window grid. */
  runGap: 0.15,
} as const;

/**
 * - "facade": a regular volume, with windows and a parapet.
 * - "tiny": too small for a facade of its own; it joins a neighbour's window grid if it is flush with it, and has no parapet.
 * - "rooftop": a machine room or tank poking out of a roof: solid clay, no windows, no parapet.
 */
export type PartKind = "facade" | "tiny" | "rooftop";

/** A stretch [t0, t1] (meters from the edge start) of one edge, and how high a neighbouring part hides it. */
export interface WallSpan {
  t0: number;
  t1: number;
  /** Height up to which a neighbouring part covers this stretch; 0 when nothing does. */
  cover: number;
  /** Whether the parapet runs along this stretch (the part's roof is exposed here). */
  parapet: boolean;
}

export interface PlannedEdge {
  a: Vec2;
  b: Vec2;
  length: number;
  /** Unit direction a -> b. */
  dir: Vec2;
  spans: WallSpan[];
}

export interface PlannedPart {
  /** Index into building.parts. */
  source: number;
  /** Counter-clockwise, cleaned and simplified. */
  ring: Ring;
  height: number;
  area: number;
  kind: PartKind;
  /** Storeys with windows on this part. */
  levels: number;
  /** Parapet height above the roof; 0 without a parapet. */
  parapetHeight: number;
  /** Mitred inner corners of the parapet, one per ring vertex; null without a parapet. */
  parapetInner: Ring | null;
  edges: PlannedEdge[];
}

/** Window grid of one exposed wall stretch: u along the shared run, centred on it. */
export interface FacadeLayout {
  /** Edge-local u at the stretch's start and end, centred on its run. */
  u0: number;
  u1: number;
  /** Half the run length; 0 means "no windows here". */
  halfLength: number;
  /** Stable id of the run, so lit windows are seeded per facade. */
  runId: number;
}

export interface BuildingPlan {
  parts: PlannedPart[];
  floorHeight: number;
  /** Key `${part}:${edge}:${span}` -> its window layout, for every exposed wall stretch. */
  facades: Map<string, FacadeLayout>;
}

export function facadeKey(part: number, edge: number, span: number): string {
  return `${part}:${edge}:${span}`;
}

/** Storey height the window grid uses: the GCBA model's real 2.8 m, or height / levels. */
export function floorHeightOf(building: Building): number {
  if (building.heightSource === "gcba") return PLAN_SPEC.gcbaFloorHeight;
  const levels = Math.max(1, building.levels);
  return Math.min(PLAN_SPEC.maxFloorHeight, Math.max(PLAN_SPEC.minFloorHeight, Math.max(building.height, PLAN_SPEC.minHeight) / levels));
}

function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** Drops vertices that barely deviate from the line through their neighbours. */
export function simplifyRing(ring: Ring, tolerance: number = PLAN_SPEC.simplifyTolerance): Ring {
  let out = cleanRing(ring);
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const curr = out[i];
      const next = out[(i + 1) % out.length];
      const span = distance(prev, next);
      if (span < 1e-9) continue;
      const deviation = Math.abs(cross(sub(next, prev), sub(curr, prev))) / span;
      // Only drop a vertex that lies between its neighbours: a spike back along the line is not noise.
      const along = dot(sub(curr, prev), sub(next, prev)) / (span * span);
      if (deviation < tolerance && along > 0 && along < 1) {
        out = [...out.slice(0, i), ...out.slice(i + 1)];
        changed = true;
        i--;
      }
    }
  }
  return out;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(ring: Ring): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of ring) {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  }
  return b;
}

function boundsTouch(a: Bounds, b: Bounds, margin: number): boolean {
  return a.minX <= b.maxX + margin && b.minX <= a.maxX + margin && a.minY <= b.maxY + margin && b.minY <= a.maxY + margin;
}

interface Solid {
  ring: Ring;
  height: number;
  bounds: Bounds;
}

/**
 * Splits edge a -> b of one part into stretches by how high the other parts
 * hide it. A neighbour hides a stretch when one of its edges runs along the
 * same line in the opposite direction (both rings are counter-clockwise, so
 * the neighbour lies on the other side of the wall).
 */
export function coverSpans(a: Vec2, b: Vec2, others: readonly Solid[], tolerance: number = PLAN_SPEC.sharedWallTolerance): Array<{ t0: number; t1: number; cover: number }> {
  const length = distance(a, b);
  const dir = normalize(sub(b, a));
  const intervals: Array<{ lo: number; hi: number; height: number }> = [];
  const edgeBounds = boundsOf([a, b]);
  for (const other of others) {
    if (!boundsTouch(edgeBounds, other.bounds, tolerance)) continue;
    const ring = other.ring;
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i];
      const g = ring[(i + 1) % ring.length];
      const len = distance(c, g);
      if (len < 1e-3) continue;
      const d = [(g[0] - c[0]) / len, (g[1] - c[1]) / len] as Vec2;
      if (dot(dir, d) > -0.999) continue;
      if (Math.abs(cross(dir, sub(c, a))) > tolerance || Math.abs(cross(dir, sub(g, a))) > tolerance) continue;
      const tc = dot(dir, sub(c, a));
      const tg = dot(dir, sub(g, a));
      const lo = Math.max(0, Math.min(tc, tg));
      const hi = Math.min(length, Math.max(tc, tg));
      if (hi - lo > 1e-3) intervals.push({ lo, hi, height: other.height });
    }
  }
  if (intervals.length === 0) return [{ t0: 0, t1: length, cover: 0 }];

  const cuts = [0, length, ...intervals.flatMap((i) => [i.lo, i.hi])].sort((x, y) => x - y);
  const breaks: number[] = [];
  for (const t of cuts) if (breaks.length === 0 || t - breaks[breaks.length - 1] > 1e-3) breaks.push(t);
  breaks[breaks.length - 1] = length;

  const spans: Array<{ t0: number; t1: number; cover: number }> = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const t0 = breaks[i];
    const t1 = breaks[i + 1];
    const mid = (t0 + t1) / 2;
    let cover = 0;
    for (const iv of intervals) if (iv.lo <= mid && mid <= iv.hi) cover = Math.max(cover, iv.height);
    const last = spans[spans.length - 1];
    if (last && last.cover === cover) last.t1 = t1;
    else spans.push({ t0, t1, cover });
  }
  return spans;
}

function levelsFor(building: Building, height: number, floorHeight: number): number {
  const fit = Math.max(1, Math.floor(height / floorHeight + 0.05));
  // OSM and estimated heights come with a storey count: never draw more rows than it says.
  return building.heightSource === "gcba" ? fit : Math.min(Math.max(1, building.levels), fit);
}

/**
 * Inner corners of the parapet, or null if they are not trustworthy: every
 * inner edge must keep the direction of its outer edge, otherwise short noisy
 * edges would fold the parapet strips over each other.
 */
function parapetCorners(ring: Ring, inset: number): Ring | null {
  const inner = insetRing(ring, inset);
  if (!inner || inner.length !== ring.length) return null;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const outer = sub(ring[j], ring[i]);
    const inside = sub(inner[j], inner[i]);
    if (dot(outer, inside) <= 1e-6) return null;
  }
  return inner;
}

type CoveredEdge = { length: number; spans: Array<{ t0: number; t1: number; cover: number }> };

/**
 * A machine room, tank or stair head: a small volume that pokes out of the
 * roof around it. GCBA models it as its own piece from the ground up, so it
 * shows only as a short block above its neighbours, and windows on it would
 * read as a penthouse.
 */
function isRooftopVolume(area: number, height: number, edges: CoveredEdge[]): boolean {
  if (area >= PLAN_SPEC.rooftopMaxArea) return false;
  const threshold = Math.max(height - PLAN_SPEC.rooftopExposure, height / 2);
  let total = 0;
  let covered = 0;
  for (const edge of edges) {
    total += edge.length;
    for (const span of edge.spans) {
      // Something it touches is as tall: it does not poke out, it is part of a larger mass.
      if (span.cover >= height - 1e-3) return false;
      if (span.cover >= threshold) covered += span.t1 - span.t0;
    }
  }
  return total > 0 && covered / total >= PLAN_SPEC.rooftopCoveredShare;
}

/** Plans every part of a building: wall stretches, kinds, parapets and facade runs. */
export function planBuilding(building: Building): BuildingPlan {
  const floorHeight = floorHeightOf(building);
  const solids: Array<Solid & { source: number; area: number }> = [];
  partsOf(building).forEach((part, source) => {
    const ring = withOrientation(simplifyRing(part.footprint), true);
    if (ring.length < 3) return;
    const area = signedArea(ring);
    if (area < 0.5) return;
    solids.push({ source, ring, height: Math.max(part.height, PLAN_SPEC.minHeight), bounds: boundsOf(ring), area });
  });

  const parts: PlannedPart[] = solids.map((solid) => {
    const others = solids.filter((s) => s !== solid);
    const edges = solid.ring.map((a, i) => {
      const b = solid.ring[(i + 1) % solid.ring.length];
      return { a, b, length: distance(a, b), dir: normalize(sub(b, a)), spans: coverSpans(a, b, others) };
    });

    let kind: PartKind = "facade";
    if (isRooftopVolume(solid.area, solid.height, edges)) {
      kind = "rooftop";
    } else if (solid.area < PLAN_SPEC.tinyArea) {
      kind = "tiny";
    }

    const levels = levelsFor(building, solid.height, floorHeight);
    const parapetInner = kind === "facade" ? parapetCorners(solid.ring, PLAN_SPEC.parapetInset) : null;
    const parapetHeight = parapetInner ? (levels <= 2 ? PLAN_SPEC.parapetLow : PLAN_SPEC.parapetTall) : 0;
    const planned: PlannedEdge[] = edges.map((edge) => ({
      ...edge,
      // A parapet only where the roof meets the open air: not against an equal or taller neighbour.
      spans: edge.spans.map((span) => ({ ...span, parapet: parapetHeight > 0 && span.cover < solid.height - 1e-3 })),
    }));
    return {
      source: solid.source,
      ring: solid.ring,
      height: solid.height,
      area: solid.area,
      kind,
      levels,
      parapetHeight,
      parapetInner,
      edges: planned,
    };
  });

  return { parts, floorHeight, facades: layoutFacades(parts) };
}

/** Top of the wall drawn along a span: the parapet rim where it runs, the roof elsewhere. */
export function spanTop(part: PlannedPart, span: WallSpan): number {
  return span.parapet ? part.height + part.parapetHeight : part.height;
}

interface Stretch {
  key: string;
  dir: Vec2;
  /** Offset of the wall's line along its outward normal. */
  offset: number;
  s0: number;
  s1: number;
  windowed: boolean;
}

/**
 * Groups the exposed wall stretches that lie on one plane into runs, and lays
 * the window grid out per run. A tower flush with its podium, or a facade the
 * photogrammetry cut into slivers, then reads as one facade with continuous
 * window columns instead of a patchwork of small grids. Rooftop volumes stay
 * blind; a run made only of tiny parts stays blind too.
 */
function layoutFacades(parts: PlannedPart[]): Map<string, FacadeLayout> {
  const stretches: Stretch[] = [];
  parts.forEach((part, p) => {
    if (part.kind === "rooftop") return;
    part.edges.forEach((edge, e) => {
      const normal: Vec2 = [edge.dir[1], -edge.dir[0]];
      const offset = dot(normal, edge.a);
      const base = dot(edge.dir, edge.a);
      edge.spans.forEach((span, s) => {
        if (span.cover >= spanTop(part, span) - 1e-3) return;
        stretches.push({ key: facadeKey(p, e, s), dir: edge.dir, offset, s0: base + span.t0, s1: base + span.t1, windowed: part.kind === "facade" });
      });
    });
  });

  // Plane groups, in a stable order: the first stretch of each group founds it.
  const groups: Stretch[][] = [];
  for (const stretch of stretches) {
    const group = groups.find((g) => dot(g[0].dir, stretch.dir) > 0.9995 && Math.abs(g[0].offset - stretch.offset) < PLAN_SPEC.sharedWallTolerance);
    if (group) group.push(stretch);
    else groups.push([stretch]);
  }

  const layouts = new Map<string, FacadeLayout>();
  let runId = 0;
  for (const group of groups) {
    // Members share one direction (within 2°), so their positions along it compare directly.
    const sorted = [...group].sort((x, y) => x.s0 - y.s0 || x.s1 - y.s1);
    let run: Stretch[] = [];
    let runEnd = -Infinity;
    const flush = () => {
      const start = run[0].s0;
      const centre = (start + runEnd) / 2;
      const half = run.some((s) => s.windowed) ? (runEnd - start) / 2 : 0;
      for (const s of run) layouts.set(s.key, { u0: s.s0 - centre, u1: s.s1 - centre, halfLength: half, runId });
      runId++;
      run = [];
    };
    for (const s of sorted) {
      if (run.length > 0 && s.s0 > runEnd + PLAN_SPEC.runGap) flush();
      runEnd = run.length > 0 ? Math.max(runEnd, s.s1) : s.s1;
      run.push(s);
    }
    if (run.length > 0) flush();
  }
  return layouts;
}
