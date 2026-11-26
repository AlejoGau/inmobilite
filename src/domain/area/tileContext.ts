import { intersect } from "@turf/intersect";
import { union } from "@turf/union";
import { difference } from "@turf/difference";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import type { Projection } from "../geo/projection";
import type { TileId } from "../geo/tiles";
import { centroid, normalizeRing, pointInRing, polygonArea } from "../geo/polygon";
import { clipPolylineToCircle, closestTOnSegment, distanceToSegment, polylineLength } from "../geo/polyline";
import { SegmentGrid } from "../geo/segmentGrid";
import { cross, distance, dot, length, lerp, round3, roundVec, sub } from "../geo/vec";
import { hashString } from "../seed";
import { MAX_BUILDINGS, type Building, type Park, type Ring, type Road, type RoadClass, type Vec2 } from "../types";
import { resolveHeight, resolveUse } from "./buildingHeight";
import { MIN_BUILDING_AREA } from "./buildings";
import { isVehicular, ROAD_CLIP_MARGIN, ROAD_WIDTHS, roadClassOf } from "./roads";

/**
 * Streets, parks, POIs and fallback buildings from OpenMapTiles-schema vector
 * tiles (OpenFreeMap). Pure and deterministic: the output is sorted by
 * geometry, so neither the tile order nor the feature order inside a tile
 * changes the model.
 *
 * The infra layer has already clipped every geometry to its tile's exact
 * bounds, so a feature crossing a tile edge arrives as fragments that abut.
 * This module stitches road fragments back into one polyline and unions
 * park and building fragments, so nothing overlaps (overlapping coplanar
 * surfaces z-fight in the scene) and nothing shows a seam.
 */

// ---------------------------------------------------------------- contract

/**
 * One decoded tile feature in lng/lat. The infra TileFeature satisfies it
 * structurally, so the domain does not depend on the decoder.
 */
export interface VectorFeature {
  layer: string;
  geometry: Geometry;
  properties: Record<string, string | number | boolean>;
  /** The tile the geometry was clipped to. Fragments from different tiles are reunited. */
  tile?: TileId;
}

export interface Poi {
  name: string;
  position: Vec2;
  /** OpenMapTiles poi class: "cafe", "shop", "restaurant", "park"… */
  class: string;
  subclass?: string;
}

export interface TileContext {
  roads: Road[];
  /** Footways that run along a street: street trees stand on them (see trees.ts). */
  sidewalkIds: Set<string>;
  parks: Park[];
  /** Named points within the radius, closest first. */
  pois: Poi[];
  /**
   * Footprints from the tile's building layer, for places the GCBA 3D model
   * does not cover (outside CABA). The closest 3·MAX_BUILDINGS, closest
   * first; the compose stage picks the final ones.
   */
  fallbackBuildings: Building[];
}

export function contextFromTiles(features: VectorFeature[], projection: Projection, radius: number): TileContext {
  const layers = groupByLayer(features);
  const { roads, sidewalkIds } = extractTileRoads(layers.transportation, layers.transportation_name, projection, radius);
  const pois = extractPois(layers.poi, projection, radius);
  const parks = extractTileParks([...layers.landcover, ...layers.landuse], pois, projection, radius);
  const fallbackBuildings = extractFallbackBuildings(layers.building, projection);
  return { roads, sidewalkIds, parks, pois, fallbackBuildings };
}

type LayerName = "transportation" | "transportation_name" | "landcover" | "landuse" | "poi" | "building";

function groupByLayer(features: VectorFeature[]): Record<LayerName, VectorFeature[]> {
  const layers: Record<LayerName, VectorFeature[]> = {
    transportation: [],
    transportation_name: [],
    landcover: [],
    landuse: [],
    poi: [],
    building: [],
  };
  for (const feature of features) {
    if (feature.layer in layers) layers[feature.layer as LayerName].push(feature);
  }
  return layers;
}

// ---------------------------------------------------------------- shared helpers

function stringProp(f: VectorFeature, key: string): string | undefined {
  const value = f.properties[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberProp(f: VectorFeature, key: string): number | undefined {
  const value = f.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function tileKey(tile: TileId | undefined): string {
  return tile ? `${tile.z}/${tile.x}/${tile.y}` : "";
}

function lines(geometry: Geometry): Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function polygons(geometry: Geometry): Position[][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function points(geometry: Geometry): Position[] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "MultiPoint") return geometry.coordinates;
  return [];
}

function project(line: Position[], projection: Projection): Vec2[] {
  return line.map((p) => projection.toLocal(p[0], p[1]));
}

/** Centimetre key: the same tile edge or the same OSM node lands on the same key. */
function pointKey(p: Vec2): string {
  return `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
}

/** Deterministic id from a geometry, unique within `used`: tiles carry no stable OSM ids. */
function geometryId(prefix: string, signature: string, used: Set<string>): string {
  const base = `${prefix}${hashString(signature).toString(36)}`;
  let id = base;
  for (let n = 1; used.has(id); n++) id = `${base}:${n}`;
  used.add(id);
  return id;
}

function ringSignature(ring: Vec2[]): string {
  return ring.map((p) => `${p[0]},${p[1]}`).join(";");
}

function compareVec(a: Vec2, b: Vec2): number {
  return a[0] - b[0] || a[1] - b[1];
}

// ---------------------------------------------------------------- roads

/** Clipped pieces shorter than this are slivers at the circle edge (as in roads.ts). */
const MIN_PIECE_LENGTH = 1;
/**
 * A named line belongs to a road when it runs within this distance and
 * parallel. Both layers come from the same OSM ways quantised to the same
 * tile grid (~0.5 m at z14), so they normally coincide; 3 m absorbs the
 * simplification while staying under the gap between two carriageways.
 */
const NAME_MATCH_DISTANCE = 3;
/** |cos| of the angle between a road segment and a named segment for them to count as parallel (~20°). */
const PARALLEL_COS = Math.cos((20 * Math.PI) / 180);
/**
 * At z14 the tiles are simplified, so a street crossing an avenue often has
 * no vertex at the crossing (or ends a few decimetres short of it). The
 * scene finds junctions by shared vertices, so they are re-noded within this distance.
 */
const NODE_SNAP_DISTANCE = 0.75;
/** A footway this close to a carriageway edge, and parallel to it, is its sidewalk. */
const SIDEWALK_MAX_GAP = 4.5;
/** Share of a footway's length that must run along a street for it to count as a sidewalk. */
const SIDEWALK_MIN_SHARE = 0.6;

interface RoadPiece {
  cls: RoadClass;
  /** OSM layer: roads on different layers (a bridge over a street) never join. */
  layer: number;
  points: Vec2[];
  name?: string;
  /** A plain footway, the only kind of path that can be a sidewalk. */
  footwayPath: boolean;
}

/**
 * OpenMapTiles transportation class to the contract's RoadClass, or null for
 * what the maquette does not draw: rail, transit, ferries, aerialways, lines
 * under construction, indoor corridors, platforms and anything underground.
 */
export function tileRoadClass(f: VectorFeature): RoadClass | null {
  const cls = stringProp(f, "class");
  if (!cls || cls.endsWith("_construction")) return null;
  if (stringProp(f, "brunnel") === "tunnel" || (numberProp(f, "layer") ?? 0) < 0) return null;
  if (f.properties.indoor === 1 || f.properties.indoor === true) return null;
  if (cls === "minor") return "residential";
  if (cls === "path") {
    const subclass = stringProp(f, "subclass");
    if (subclass === "pedestrian") return "pedestrian";
    // Platforms are stops (subway ones underground), corridors are indoors: neither is a walkway on the street.
    if (subclass === "platform" || subclass === "corridor") return null;
    return "footway";
  }
  // motorway, trunk, primary, secondary, tertiary and service share OSM's highway values.
  return roadClassOf(cls);
}

export interface TileRoads {
  roads: Road[];
  sidewalkIds: Set<string>;
}

export function extractTileRoads(
  transportation: VectorFeature[],
  names: VectorFeature[],
  projection: Projection,
  radius: number,
): TileRoads {
  const clipRadius = radius + ROAD_CLIP_MARGIN;
  const pieces: RoadPiece[] = [];
  for (const f of transportation) {
    const cls = tileRoadClass(f);
    if (!cls) continue;
    const layer = numberProp(f, "layer") ?? 0;
    const footwayPath = cls === "footway" && stringProp(f, "subclass") === "footway";
    for (const line of lines(f.geometry)) {
      for (const piece of clipPolylineToCircle(project(line, projection), clipRadius)) {
        pieces.push({ cls, layer, points: piece, footwayPath });
      }
    }
  }

  const nameIndex = buildNameIndex(names, projection, clipRadius);
  const named = nodeCarriageways(pieces).flatMap((piece) => splitByName(piece, nameIndex));
  const stitched = stitchPieces(named).filter((piece) => polylineLength(piece.points) >= MIN_PIECE_LENGTH);
  return finishRoads(stitched);
}

// --- noding

interface Insertion {
  segment: number;
  t: number;
  point: Vec2;
}

/**
 * Adds the junction vertices the tile simplification dropped: where a
 * carriageway ends on another one (a T) or crosses it (an X). Endpoints a few
 * centimetres off another road's vertex snap onto it. Only roads on the same
 * layer are noded, so a bridge never meets the street under it.
 *
 * Quadratic in the number of pieces, with a bounding-box test first: a
 * 330 m disc holds a few hundred carriageway pieces, which this handles in
 * a few milliseconds.
 */
function nodeCarriageways(pieces: RoadPiece[]): RoadPiece[] {
  const carriageways = pieces.map((piece, index) => ({ piece, index })).filter(({ piece }) => isVehicularClass(piece.cls));
  const out = pieces.map((piece) => ({ ...piece, points: piece.points.slice() }));
  const insertions = new Map<number, Insertion[]>();
  const addInsertion = (index: number, insertion: Insertion) => {
    const list = insertions.get(index);
    if (list) list.push(insertion);
    else insertions.set(index, [insertion]);
  };
  const boxes = out.map((piece) => expandedBox(piece.points, NODE_SNAP_DISTANCE));

  for (const { index: i } of carriageways) {
    for (const { index: j } of carriageways) {
      if (i === j || out[i].layer !== out[j].layer || !boxesOverlap(boxes[i], boxes[j])) continue;
      // T: an end of i lies on j. Only i's ends are looked at here; j's ends are covered by the (j, i) pass.
      for (const endIndex of [0, out[i].points.length - 1]) {
        const end = out[i].points[endIndex];
        const vertex = out[j].points.find((v) => distance(v, end) < NODE_SNAP_DISTANCE);
        if (vertex) {
          out[i].points[endIndex] = vertex;
          continue;
        }
        const hit = closestInterior(end, out[j].points);
        if (hit) addInsertion(j, { segment: hit.segment, t: hit.t, point: end });
      }
      // X: the two cross. Each unordered pair is handled once.
      if (i < j) {
        for (const x of segmentCrossings(out[i].points, out[j].points)) {
          if (x.vertexA === undefined && x.vertexB === undefined) {
            addInsertion(i, { segment: x.segmentA, t: x.tA, point: x.point });
            addInsertion(j, { segment: x.segmentB, t: x.tB, point: x.point });
          } else if (x.vertexB === undefined) {
            // The crossing sits next to a vertex of i only: that vertex becomes the junction, threaded into j.
            const v = out[i].points[x.vertexA as number];
            addInsertion(j, { segment: x.segmentB, t: closestTOnSegment(v, out[j].points[x.segmentB], out[j].points[x.segmentB + 1]), point: v });
          } else if (x.vertexA === undefined) {
            const v = out[j].points[x.vertexB];
            addInsertion(i, { segment: x.segmentA, t: closestTOnSegment(v, out[i].points[x.segmentA], out[i].points[x.segmentA + 1]), point: v });
          } else {
            // Next to a vertex of each: both collapse onto the smaller one, so the choice does not depend on input order.
            const [va, vb] = [out[i].points[x.vertexA], out[j].points[x.vertexB]];
            const shared = compareVec(va, vb) <= 0 ? va : vb;
            out[i].points[x.vertexA] = shared;
            out[j].points[x.vertexB] = shared;
          }
        }
      }
    }
  }

  for (const [index, list] of insertions) out[index].points = insertVertices(out[index].points, list);
  return out;
}

function isVehicularClass(cls: RoadClass): boolean {
  return isVehicular({ id: "", cls, width: ROAD_WIDTHS[cls], points: [] });
}

type Box = [minX: number, minY: number, maxX: number, maxY: number];

function expandedBox(pts: Vec2[], pad: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Closest point of a polyline to p when it is within the snap distance and clear of every vertex. */
function closestInterior(p: Vec2, pts: Vec2[]): { segment: number; t: number } | null {
  let best: { segment: number; t: number; d: number } | null = null;
  for (let s = 0; s < pts.length - 1; s++) {
    const d = distanceToSegment(p, pts[s], pts[s + 1]);
    if (d < NODE_SNAP_DISTANCE && (!best || d < best.d)) best = { segment: s, t: closestTOnSegment(p, pts[s], pts[s + 1]), d };
  }
  if (!best) return null;
  const q = lerp(pts[best.segment], pts[best.segment + 1], best.t);
  const nearVertex = distance(q, pts[best.segment]) < NODE_SNAP_DISTANCE || distance(q, pts[best.segment + 1]) < NODE_SNAP_DISTANCE;
  return nearVertex ? null : { segment: best.segment, t: best.t };
}

interface Crossing {
  point: Vec2;
  segmentA: number;
  tA: number;
  segmentB: number;
  tB: number;
  /** Index of the vertex of a within the snap distance of the crossing, if any. */
  vertexA?: number;
  vertexB?: number;
}

/**
 * Proper crossings of two polylines. A crossing a few decimetres from a
 * vertex is reported with that vertex: inserting a second point that close
 * would leave a sliver segment, so the caller reuses the vertex instead.
 * Crossings already on a shared vertex never show up (segmentIntersection
 * excludes the segment ends).
 */
function segmentCrossings(a: Vec2[], b: Vec2[]): Crossing[] {
  const crossings: Crossing[] = [];
  for (let s = 0; s < a.length - 1; s++) {
    for (let u = 0; u < b.length - 1; u++) {
      const hit = segmentIntersection(a[s], a[s + 1], b[u], b[u + 1]);
      if (!hit) continue;
      const crossing: Crossing = { point: hit.point, segmentA: s, tA: hit.t, segmentB: u, tB: hit.u };
      const vertexA = nearVertex(hit.point, a, s);
      const vertexB = nearVertex(hit.point, b, u);
      if (vertexA !== undefined) crossing.vertexA = vertexA;
      if (vertexB !== undefined) crossing.vertexB = vertexB;
      crossings.push(crossing);
    }
  }
  return crossings;
}

/** The end of segment `s` of `pts` within the snap distance of p (the closer one), if any. */
function nearVertex(p: Vec2, pts: Vec2[], s: number): number | undefined {
  const [d0, d1] = [distance(p, pts[s]), distance(p, pts[s + 1])];
  if (Math.min(d0, d1) >= NODE_SNAP_DISTANCE) return undefined;
  return d0 <= d1 ? s : s + 1;
}

function segmentIntersection(p: Vec2, p2: Vec2, q: Vec2, q2: Vec2): { point: Vec2; t: number; u: number } | null {
  const r = sub(p2, p);
  const s = sub(q2, q);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-9) return null;
  const qp = sub(q, p);
  const t = cross(qp, s) / denominator;
  const u = cross(qp, r) / denominator;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { point: lerp(p, p2, t), t, u };
}

function insertVertices(pts: Vec2[], list: Insertion[]): Vec2[] {
  const sorted = list.slice().sort((x, y) => x.segment - y.segment || x.t - y.t);
  const out: Vec2[] = [];
  let k = 0;
  for (let s = 0; s < pts.length; s++) {
    out.push(pts[s]);
    while (k < sorted.length && sorted[k].segment === s) {
      // Two roads ending at the same spot insert the same point twice; keep one.
      if (distance(out[out.length - 1], sorted[k].point) > 1e-6) out.push(sorted[k].point);
      k++;
    }
  }
  return out;
}

// --- names

interface NamedSegment {
  name: string;
  direction: Vec2;
}

/** Grid cell for the named segments; any size works, this one keeps buckets small in a city grid. */
const NAME_GRID_CELL = 25;

function buildNameIndex(names: VectorFeature[], projection: Projection, clipRadius: number): SegmentGrid<NamedSegment> {
  const grid = new SegmentGrid<NamedSegment>(NAME_GRID_CELL, NAME_MATCH_DISTANCE);
  const reach = clipRadius + NAME_MATCH_DISTANCE;
  for (const f of names) {
    const name = stringProp(f, "name");
    if (!name) continue;
    for (const line of lines(f.geometry)) {
      const pts = project(line, projection);
      for (let i = 0; i < pts.length - 1; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        const len = distance(a, b);
        if (len === 0 || distanceToSegment([0, 0], a, b) > reach) continue;
        grid.insert(a, b, { name, direction: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] });
      }
    }
  }
  return grid;
}

/** The name of the closest parallel named line within reach of the segment's midpoint. */
function nameOfSegment(a: Vec2, b: Vec2, index: SegmentGrid<NamedSegment>): string | undefined {
  const len = distance(a, b);
  if (len === 0) return undefined;
  const direction: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  let best: { name: string; d: number } | undefined;
  // `some` visits every segment near the point; returning false keeps it looking for the best one.
  index.some(lerp(a, b, 0.5), (d, segment) => {
    const parallel = Math.abs(dot(direction, segment.direction)) >= PARALLEL_COS;
    if (parallel && d <= NAME_MATCH_DISTANCE && (!best || d < best.d || (d === best.d && segment.name < best.name))) {
      best = { name: segment.name, d };
    }
    return false;
  });
  return best?.name;
}

/**
 * The transportation layer merges ways with equal attributes regardless of
 * their names, so one line can be Avenida Acoyte north of Rivadavia and
 * Avenida José María Moreno south of it. Each segment gets its own name and
 * the line is split where the name changes.
 */
function splitByName(piece: RoadPiece, index: SegmentGrid<NamedSegment>): RoadPiece[] {
  const pts = piece.points;
  const out: RoadPiece[] = [];
  let start = 0;
  let current = nameOfSegment(pts[0], pts[1], index);
  const emit = (end: number) => {
    const run: RoadPiece = { ...piece, points: pts.slice(start, end + 1) };
    if (current) run.name = current;
    else delete run.name;
    out.push(run);
  };
  for (let s = 1; s < pts.length - 1; s++) {
    const name = nameOfSegment(pts[s], pts[s + 1], index);
    if (name !== current) {
      emit(s);
      start = s;
      current = name;
    }
  }
  emit(pts.length - 1);
  return out;
}

// --- stitching

/**
 * Joins pieces that continue each other: exactly two ends meet at a point no
 * other road touches, with the same class, name and layer. That reunites a
 * road cut at a tile edge (the scene would otherwise extend both ends into a
 * square cap and the two ribbons would overlap) and merges lines the tiles
 * split for no visible reason. Real junctions keep their split.
 */
function stitchPieces(pieces: RoadPiece[]): RoadPiece[] {
  const vertexUse = new Map<string, number>();
  for (const piece of pieces) {
    for (const p of piece.points) vertexUse.set(pointKey(p), (vertexUse.get(pointKey(p)) ?? 0) + 1);
  }
  const alive = new Set<RoadPiece>(pieces);
  const byEnd = new Map<string, RoadPiece[]>();
  const addEnds = (piece: RoadPiece) => {
    for (const p of [piece.points[0], piece.points[piece.points.length - 1]]) {
      const key = pointKey(p);
      const list = byEnd.get(key);
      if (list) list.push(piece);
      else byEnd.set(key, [piece]);
    }
  };
  pieces.forEach(addEnds);

  // Sorted keys: the joins, and so the vertex order of the result, do not depend on input order.
  const joinKeys = [...byEnd.keys()].filter((key) => vertexUse.get(key) === 2).sort();
  for (const key of joinKeys) {
    const [a, b] = (byEnd.get(key) ?? []).filter((piece) => alive.has(piece));
    if (!a || !b || a === b || !sameStreet(a, b)) continue;
    const merged = joinAt(a, b, key);
    alive.delete(a);
    alive.delete(b);
    alive.add(merged);
    addEnds(merged);
  }
  return [...alive];
}

function sameStreet(a: RoadPiece, b: RoadPiece): boolean {
  return a.cls === b.cls && a.name === b.name && a.layer === b.layer && a.footwayPath === b.footwayPath;
}

function joinAt(a: RoadPiece, b: RoadPiece, key: string): RoadPiece {
  const aEndsHere = pointKey(a.points[a.points.length - 1]) === key;
  const bStartsHere = pointKey(b.points[0]) === key;
  const first = aEndsHere ? a.points : a.points.slice().reverse();
  const second = bStartsHere ? b.points : b.points.slice().reverse();
  return { ...a, points: [...first, ...second.slice(1)] };
}

// --- output

function finishRoads(pieces: RoadPiece[]): TileRoads {
  // A stitched line runs whichever way its first piece ran, which depends on the input order; the
  // contract carries no direction (no one-ways), so each line is oriented from its smaller end.
  const rounded = pieces.map((piece) => {
    const pts = piece.points.map(roundVec);
    return { ...piece, points: compareVec(pts[pts.length - 1], pts[0]) < 0 ? pts.reverse() : pts };
  });
  rounded.sort(
    (a, b) =>
      compareVec(a.points[0], b.points[0]) ||
      compareVec(a.points[a.points.length - 1], b.points[b.points.length - 1]) ||
      a.cls.localeCompare(b.cls) ||
      (a.name ?? "").localeCompare(b.name ?? "") ||
      a.points.length - b.points.length ||
      // The two carriageways of a divided avenue can share both ends and the vertex count.
      ringSignature(a.points).localeCompare(ringSignature(b.points)),
  );

  const used = new Set<string>();
  const roads: Road[] = rounded.map((piece) => {
    const road: Road = {
      id: geometryId("ofm:road:", `${piece.cls}|${piece.name ?? ""}|${ringSignature(piece.points)}`, used),
      cls: piece.cls,
      width: ROAD_WIDTHS[piece.cls],
      points: piece.points,
    };
    if (piece.name) road.name = piece.name;
    return road;
  });
  return { roads, sidewalkIds: findSidewalks(roads, rounded) };
}

/**
 * OpenMapTiles drops OSM's footway=sidewalk, so sidewalks are recognised by
 * shape: a plain footway that mostly runs parallel to a carriageway, just
 * past its kerb. Trees must not treat those as a surface to avoid.
 */
function findSidewalks(roads: Road[], pieces: RoadPiece[]): Set<string> {
  const carriageways = roads.filter(isVehicular);
  const maxHalfWidth = Math.max(0, ...carriageways.map((r) => r.width / 2));
  const grid = new SegmentGrid<{ halfWidth: number; direction: Vec2 }>(NAME_GRID_CELL, maxHalfWidth + SIDEWALK_MAX_GAP);
  for (const road of carriageways) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const [a, b] = [road.points[i], road.points[i + 1]];
      const len = distance(a, b);
      if (len > 0) grid.insert(a, b, { halfWidth: road.width / 2, direction: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] });
    }
  }

  const sidewalks = new Set<string>();
  roads.forEach((road, i) => {
    if (!pieces[i].footwayPath) return;
    let along = 0;
    for (let s = 0; s < road.points.length - 1; s++) {
      const [a, b] = [road.points[s], road.points[s + 1]];
      const len = distance(a, b);
      if (len === 0) continue;
      const direction: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const besideStreet = grid.some(
        lerp(a, b, 0.5),
        (d, street) => d <= street.halfWidth + SIDEWALK_MAX_GAP && Math.abs(dot(direction, street.direction)) >= PARALLEL_COS,
      );
      if (besideStreet) along += len;
    }
    if (along >= SIDEWALK_MIN_SHARE * polylineLength(road.points)) sidewalks.add(road.id);
  });
  return sidewalks;
}

// ---------------------------------------------------------------- POIs

export function extractPois(features: VectorFeature[], projection: Projection, radius: number): Poi[] {
  const pois: Poi[] = [];
  for (const f of features) {
    const name = stringProp(f, "name");
    const cls = stringProp(f, "class");
    if (!name || !cls) continue;
    for (const p of points(f.geometry)) {
      const position = roundVec(projection.toLocal(p[0], p[1]));
      if (length(position) > radius) continue;
      const poi: Poi = { name, position, class: cls };
      const subclass = stringProp(f, "subclass");
      if (subclass) poi.subclass = subclass;
      pois.push(poi);
    }
  }
  return pois.sort(
    (a, b) => length(a.position) - length(b.position) || a.name.localeCompare(b.name) || compareVec(a.position, b.position),
  );
}

// ---------------------------------------------------------------- parks

/** Urban green in OpenMapTiles: landcover grass with these subclasses (the "park" layer is national parks). */
const PARK_SUBCLASSES = new Set(["park", "garden", "recreation_ground"]);
const PARK_LANDUSE = new Set(["playground"]);
/** Below this a "park" is a planter; not worth a mesh (as in parks.ts). */
const MIN_PARK_AREA = 4;
/** Vertices of the polygon that approximates the clip circle (as in parks.ts). */
const CLIP_CIRCLE_SEGMENTS = 64;

function isParkFeature(f: VectorFeature): boolean {
  if (f.layer === "landcover") return stringProp(f, "class") === "grass" && PARK_SUBCLASSES.has(stringProp(f, "subclass") ?? "");
  return f.layer === "landuse" && PARK_LANDUSE.has(stringProp(f, "class") ?? "");
}

/**
 * Parks clipped to the same disc as the roads. Every park polygon is
 * unioned first: a playground drawn inside a plaza, or a plaza cut in two at
 * a tile edge, becomes one surface instead of overlapping coplanar ones.
 * Names come from the park POI that falls inside (landcover has no names).
 */
export function extractTileParks(features: VectorFeature[], pois: Poi[], projection: Projection, radius: number): Park[] {
  const clipRadius = radius + ROAD_CLIP_MARGIN;
  const shapes: Position[][][] = [];
  for (const f of features) {
    if (!isParkFeature(f)) continue;
    for (const rings of polygons(f.geometry)) {
      const local = rings.map((ring) => project(ring, projection).map((p): Position => [p[0], p[1]]));
      if (local[0].length >= 4 && minDistanceToOrigin(local[0]) <= clipRadius) shapes.push(local);
    }
  }
  const circle = circleRing(clipRadius);
  const parkPois = pois.filter((poi) => poi.class === "park");
  const used = new Set<string>();
  const outers = unionAll(shapes)
    .flatMap((outer) => {
      const ring = normalizeRing(outer.map((p): Vec2 => [p[0], p[1]]));
      if (!ring) return [];
      return ring.every((p) => length(p) <= clipRadius) ? [ring] : clipToCircle(ring, circle);
    })
    .filter((ring) => polygonArea(ring) >= MIN_PARK_AREA)
    .map((ring) => ring.map(roundVec));

  outers.sort((a, b) => length(centroid(a)) - length(centroid(b)) || ringSignature(a).localeCompare(ringSignature(b)));
  return outers.map((polygon) => {
    const park: Park = { id: geometryId("ofm:park:", ringSignature(polygon), used), polygon };
    const name = parkName(polygon, parkPois);
    if (name) park.name = name;
    return park;
  });
}

function minDistanceToOrigin(ring: Position[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    best = Math.min(best, distanceToSegment([0, 0], [ring[i][0], ring[i][1]], [ring[i + 1][0], ring[i + 1][1]]));
  }
  return best;
}

/** Outer rings of the union. Holes are dropped: the scene draws outer shells only. */
function unionAll(shapes: Position[][][]): Position[][] {
  if (shapes.length === 0) return [];
  if (shapes.length === 1) return [shapes[0][0]];
  const result = union(featureCollection(shapes.map((rings) => turfPolygon(rings))));
  return result ? outerRingsOf(result) : [];
}

function outerRingsOf(feature: Feature<Polygon | MultiPolygon>): Position[][] {
  return feature.geometry.type === "Polygon" ? [feature.geometry.coordinates[0]] : feature.geometry.coordinates.map((poly) => poly[0]);
}

function clipToCircle(ring: Ring, circle: Ring): Ring[] {
  const result = intersect(featureCollection([turfPolygon([closeRing(ring)]), turfPolygon([closeRing(circle)])]));
  if (!result) return [];
  return outerRingsOf(result)
    .map((outer) => normalizeRing(outer.map((p): Vec2 => [p[0], p[1]])))
    .filter((r): r is Ring => r !== null);
}

function circleRing(radius: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < CLIP_CIRCLE_SEGMENTS; i++) {
    const a = (i / CLIP_CIRCLE_SEGMENTS) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return ring;
}

function closeRing(ring: Ring): Position[] {
  return [...ring, ring[0]].map((p) => [p[0], p[1]]);
}

/** The park POI inside the polygon closest to its centroid. */
function parkName(polygon: Ring, parkPois: Poi[]): string | undefined {
  const c = centroid(polygon);
  let best: Poi | undefined;
  for (const poi of parkPois) {
    if (!pointInRing(poi.position, polygon)) continue;
    if (!best || distance(poi.position, c) < distance(best.position, c)) best = poi;
  }
  return best?.name;
}

// ---------------------------------------------------------------- fallback buildings

/** OpenMapTiles' render_height when OSM has neither height nor levels. */
export const DEFAULT_RENDER_HEIGHT = 5;
const FALLBACK_CANDIDATES = 3 * MAX_BUILDINGS;
/** Grid cell (m) for finding building fragments that touch across a tile edge. */
const FRAGMENT_CELL = 25;
/** Two fragment edges closer than this, and overlapping by more than MIN_SHARED_EDGE, are one cut. */
const SHARED_EDGE_TOLERANCE = 0.05;
const MIN_SHARED_EDGE = 0.2;

interface Fragment {
  tile: string;
  height: number;
  ring: Ring;
  box: Box;
}

/**
 * The building layer as single-part Buildings. At z14 buildings with equal
 * attributes are merged into one MultiPolygon, so each polygon is split back
 * out. Building parts lifted off the ground (render_min_height > 0) and
 * outlines hidden behind their parts (hide_3d) are skipped: as prisms from
 * the ground they would overlap the volumes below them.
 */
export function extractFallbackBuildings(features: VectorFeature[], projection: Projection): Building[] {
  const fragments: Fragment[] = [];
  for (const f of features) {
    if (f.properties.hide_3d === true || (numberProp(f, "render_min_height") ?? 0) > 0) continue;
    const height = numberProp(f, "render_height") ?? DEFAULT_RENDER_HEIGHT;
    for (const rings of polygons(f.geometry)) {
      const ring = normalizeRing(project(rings[0], projection));
      if (ring) fragments.push({ tile: tileKey(f.tile), height, ring, box: expandedBox(ring, SHARED_EDGE_TOLERANCE) });
    }
  }

  const candidates = mergeAcrossTiles(fragments)
    .map(({ ring, height }) => describeCandidate(ring, height))
    .filter((c) => c.area >= MIN_BUILDING_AREA);
  candidates.sort(compareCandidates);
  const kept = removeOverlaps(candidates, FALLBACK_CANDIDATES);

  const used = new Set<string>();
  return kept.map((c) => {
    const id = geometryId("ofm:building:", c.signature, used);
    const seed = hashString(id);
    const tags: Record<string, string> = c.height !== DEFAULT_RENDER_HEIGHT ? { height: String(c.height) } : {};
    const use = resolveUse(tags);
    const height = resolveHeight(tags, use, c.area, seed);
    const footprint = c.ring.map(roundVec);
    return {
      id,
      footprint,
      parts: [{ footprint, height: height.height }],
      ...height,
      use,
      area: Math.round(c.area * 10) / 10,
      distance: round3(c.distance),
      seed,
    };
  });
}

interface Candidate {
  ring: Ring;
  height: number;
  area: number;
  distance: number;
  signature: string;
  box: Box;
}

function describeCandidate(ring: Ring, height: number): Candidate {
  return {
    ring,
    height,
    area: polygonArea(ring),
    distance: length(centroid(ring)),
    signature: ringSignature(ring.map(roundVec)),
    box: expandedBox(ring, 0),
  };
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return a.distance - b.distance || a.signature.localeCompare(b.signature);
}

/** Overlaps below this (m²) are rounding noise on a shared party wall, not worth a boolean operation. */
const MIN_OVERLAP_AREA = 0.05;

/**
 * The z14 simplification moves the vertices of neighbouring buildings
 * independently, so footprints that only shared a wall in OSM come out
 * overlapping by a few square metres (the prisms would interpenetrate and
 * their roofs z-fight). Walking closest first, each candidate loses whatever
 * the ones already kept cover; one trimmed away to a sliver is dropped. Stops
 * at `limit` kept, and returns them re-sorted, since trimming moves centroids.
 */
function removeOverlaps(sorted: Candidate[], limit: number): Candidate[] {
  const kept: Candidate[] = [];
  for (const candidate of sorted) {
    if (kept.length >= limit) break;
    const trimmed = trimAgainst(candidate, kept);
    if (trimmed) kept.push(trimmed);
  }
  return kept.sort(compareCandidates);
}

function trimAgainst(candidate: Candidate, kept: Candidate[]): Candidate | null {
  const blockers = kept.filter((k) => boxesOverlap(k.box, candidate.box));
  if (blockers.length === 0) return candidate;
  let shape: Feature<Polygon | MultiPolygon> | null = turfPolygon([closeRing(candidate.ring)]);
  let changed = false;
  for (const blocker of blockers) {
    if (!shape) break;
    const blockerShape = turfPolygon([closeRing(blocker.ring)]);
    const overlap = intersect(featureCollection([shape, blockerShape]));
    if (!overlap || outerRingsOf(overlap).reduce((sum, r) => sum + polygonArea(toVecs(r)), 0) < MIN_OVERLAP_AREA) continue;
    shape = difference(featureCollection([shape, blockerShape]));
    changed = true;
  }
  if (!changed) return candidate;
  if (!shape) return null;
  // A Building has one footprint; the largest remaining piece stands for it (as in buildings.ts).
  const rings = outerRingsOf(shape)
    .map((outer) => normalizeRing(toVecs(outer)))
    .filter((r): r is Ring => r !== null);
  const largest = rings.reduce<Ring | null>((best, r) => (!best || polygonArea(r) > polygonArea(best) ? r : best), null);
  if (!largest) return null;
  const trimmed = describeCandidate(largest, candidate.height);
  return trimmed.area >= MIN_BUILDING_AREA ? trimmed : null;
}

function toVecs(ring: Position[]): Vec2[] {
  return ring.map((p): Vec2 => [p[0], p[1]]);
}

/**
 * Reunites the fragments of a building cut by a tile edge. Two fragments from
 * different tiles with the same height that share an edge are one building:
 * after clipping, fragments of different tiles can only touch along the tile
 * boundary. Neighbours in the same tile are left alone, because there a
 * shared edge is a real party wall.
 */
function mergeAcrossTiles(fragments: Fragment[]): { ring: Ring; height: number }[] {
  const parent = fragments.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  const cells = new Map<string, number[]>();
  fragments.forEach((fragment, index) => {
    const [minX, minY, maxX, maxY] = fragment.box;
    for (let cx = Math.floor(minX / FRAGMENT_CELL); cx <= Math.floor(maxX / FRAGMENT_CELL); cx++) {
      for (let cy = Math.floor(minY / FRAGMENT_CELL); cy <= Math.floor(maxY / FRAGMENT_CELL); cy++) {
        const key = `${cx},${cy}`;
        const list = cells.get(key);
        if (list) list.push(index);
        else cells.set(key, [index]);
      }
    }
  });
  for (const list of cells.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const [a, b] = [fragments[list[x]], fragments[list[y]]];
        if (a.tile === b.tile || a.height !== b.height || !boxesOverlap(a.box, b.box)) continue;
        if (shareEdge(a.ring, b.ring)) parent[find(list[y])] = find(list[x]);
      }
    }
  }

  const groups = new Map<number, number[]>();
  fragments.forEach((_, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  });
  return [...groups.values()].map((members) => {
    const { height } = fragments[members[0]];
    if (members.length === 1) return { ring: fragments[members[0]].ring, height };
    const merged = unionAll(members.map((i) => [closeRing(fragments[i].ring)]))
      .map((outer) => normalizeRing(outer.map((p): Vec2 => [p[0], p[1]])))
      .filter((r): r is Ring => r !== null);
    // A Building has one footprint; the largest ring stands for it (as in buildings.ts).
    const ring = merged.reduce<Ring>((best, r) => (polygonArea(r) > polygonArea(best) ? r : best), merged[0] ?? fragments[members[0]].ring);
    return { ring, height };
  });
}

/** True when an edge of one ring lies on an edge of the other, overlapping by more than MIN_SHARED_EDGE. */
function shareEdge(a: Ring, b: Ring): boolean {
  for (let i = 0; i < a.length; i++) {
    const [p, q] = [a[i], a[(i + 1) % a.length]];
    const len = distance(p, q);
    if (len < MIN_SHARED_EDGE) continue;
    for (let j = 0; j < b.length; j++) {
      const [r, s] = [b[j], b[(j + 1) % b.length]];
      if (distanceToLine(r, p, q, len) > SHARED_EDGE_TOLERANCE || distanceToLine(s, p, q, len) > SHARED_EDGE_TOLERANCE) continue;
      const direction: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      const [t0, t1] = [dot(sub(r, p), direction), dot(sub(s, p), direction)].sort((x, y) => x - y);
      if (Math.min(len, t1) - Math.max(0, t0) > MIN_SHARED_EDGE) return true;
    }
  }
  return false;
}

function distanceToLine(p: Vec2, a: Vec2, b: Vec2, len: number): number {
  return Math.abs(cross(sub(b, a), sub(p, a))) / len;
}
