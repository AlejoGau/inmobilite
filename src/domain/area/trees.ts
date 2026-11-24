import type { OverpassNode } from "../osm/overpass";
import type { Projection } from "../geo/projection";
import type { Building, Park, Road, RoadClass, Ring, Tree, Vec2 } from "../types";
import { pointInRing, polygonArea } from "../geo/polygon";
import { PointGrid } from "../geo/pointGrid";
import { SegmentGrid } from "../geo/segmentGrid";
import { polylineLength } from "../geo/polyline";
import { add, distance, length, lerp, round3, roundVec, scale, sub } from "../geo/vec";
import { hashString, mulberry32, randomBetween } from "../seed";
import { tagsOf } from "./osmElements";

export const MAX_TREES = 600;
export const TREE_SCALE_RANGE = [0.7, 1.3] as const;

/** Buenos Aires streets are tree-lined; avenues and streets get sidewalk trees. */
const STREET_TREE_CLASSES = new Set<RoadClass>(["residential", "tertiary", "secondary"]);
const STREET_TREE_SPACING = [9, 13] as const;
/** From the kerb to the trunk, in meters. */
const KERB_TO_TRUNK = 1.6;
/** Small seeded slip along the street, so the rows do not look stamped. */
const ALONG_JITTER = 0.8;
/** No street trees this close to another street: corners stay open, as they do in reality. */
const INTERSECTION_CLEARANCE = 9;
/** Extra clearance from a carriageway or path edge. */
const SURFACE_MARGIN = 0.6;
/** Street trees never stand closer than this to another tree. */
const STREET_TREE_MIN_GAP = 4;

const PARK_TREE_MIN_GAP = 6;
/** One candidate per this many m² of park; spacing then thins them out. */
const PARK_AREA_PER_CANDIDATE = 70;
const PARK_FOOTWAY_CLEARANCE = 1.2;

interface RoadInfo {
  road: Road;
  /** Same physical street (same name, or the same way when unnamed). */
  streetKey: string;
  avoidSurface: boolean;
}

export interface TreeInput {
  seed: number;
  radius: number;
  projection: Projection;
  nodes: OverpassNode[];
  roads: Road[];
  sidewalkIds: ReadonlySet<string>;
  buildings: Building[];
  parks: Park[];
}

/**
 * Real OSM trees plus deterministic street and park trees. Order of the
 * output: closest to the origin first, so the director can stagger them.
 */
export function placeTrees(input: TreeInput): Tree[] {
  const placer = new TreePlacer(input);
  placer.addOsmTrees(input.nodes, input.projection);
  for (const road of input.roads) {
    if (STREET_TREE_CLASSES.has(road.cls)) placer.addStreetTrees(road);
  }
  for (const park of input.parks) placer.addParkTrees(park);
  return placer.result();
}

class TreePlacer {
  private readonly trees: Tree[] = [];
  private readonly spacing = new PointGrid(PARK_TREE_MIN_GAP);
  private readonly roadGrid: SegmentGrid<RoadInfo>;
  private readonly buildingBoxes: { ring: Ring; box: [number, number, number, number] }[];

  constructor(private readonly input: TreeInput) {
    const maxHalfWidth = Math.max(0, ...input.roads.map((r) => r.width / 2));
    this.roadGrid = new SegmentGrid<RoadInfo>(24, Math.max(INTERSECTION_CLEARANCE, maxHalfWidth + SURFACE_MARGIN));
    for (const road of input.roads) {
      const info: RoadInfo = {
        road,
        streetKey: road.name ?? road.id,
        avoidSurface: !input.sidewalkIds.has(road.id),
      };
      for (let i = 0; i < road.points.length - 1; i++) this.roadGrid.insert(road.points[i], road.points[i + 1], info);
    }
    this.buildingBoxes = input.buildings.map((b) => ({ ring: b.footprint, box: boundingBox(b.footprint) }));
  }

  addOsmTrees(nodes: OverpassNode[], projection: Projection): void {
    for (const node of nodes) {
      if (tagsOf(node).natural !== "tree") continue;
      const p = roundVec(projection.toLocal(node.lon, node.lat));
      if (length(p) > this.input.radius || this.insideBuilding(p)) continue;
      this.accept(p, mulberry32(hashString(`${this.input.seed}:node/${node.id}`)));
    }
  }

  /** Each sidewalk is walked on its own, so the two rows are not mirror images. */
  addStreetTrees(road: Road): void {
    const offset = road.width / 2 + KERB_TO_TRUNK;
    const streetKey = road.name ?? road.id;
    for (const side of [1, -1] as const) {
      const rng = mulberry32(hashString(`${this.input.seed}:${road.id}:${side}`));
      const total = polylineLength(road.points);
      for (let s = randomBetween(rng, 2, 7); s < total; s += randomBetween(rng, ...STREET_TREE_SPACING)) {
        const along = Math.min(total, Math.max(0, s + randomBetween(rng, -ALONG_JITTER, ALONG_JITTER)));
        const station = pointAtDistance(road.points, along);
        const p = roundVec(add(station.point, scale(leftNormal(station.direction), side * offset)));
        if (this.isStreetSpotFree(p, streetKey)) this.accept(p, rng);
      }
    }
  }

  addParkTrees(park: Park): void {
    const rng = mulberry32(hashString(`${this.input.seed}:${park.id}:trees`));
    const [minX, minY, maxX, maxY] = boundingBox(park.polygon);
    const candidates = Math.round(polygonArea(park.polygon) / PARK_AREA_PER_CANDIDATE);
    for (let i = 0; i < candidates; i++) {
      // Rounded before testing, so the checks see exactly the coordinates that ship.
      const p = roundVec([randomBetween(rng, minX, maxX), randomBetween(rng, minY, maxY)]);
      if (!pointInRing(p, park.polygon) || length(p) > this.input.radius) continue;
      if (this.spacing.hasWithin(p, PARK_TREE_MIN_GAP) || this.onAnySurface(p, PARK_FOOTWAY_CLEARANCE)) continue;
      if (this.insideBuilding(p)) continue;
      this.accept(p, rng);
    }
  }

  result(): Tree[] {
    const sorted = this.trees
      .map((t) => ({ t, d: length(t.position) }))
      .sort((a, b) => a.d - b.d || a.t.position[0] - b.t.position[0] || a.t.position[1] - b.t.position[1]);
    return sorted.slice(0, MAX_TREES).map(({ t }) => t);
  }

  private isStreetSpotFree(p: Vec2, streetKey: string): boolean {
    if (length(p) > this.input.radius) return false;
    if (this.spacing.hasWithin(p, STREET_TREE_MIN_GAP)) return false;
    const nearCrossStreet = this.roadGrid.some(
      p,
      (d, info) => d < INTERSECTION_CLEARANCE && info.road.cls !== "footway" && info.streetKey !== streetKey,
    );
    return !nearCrossStreet && !this.onAnySurface(p, SURFACE_MARGIN) && !this.insideBuilding(p);
  }

  private onAnySurface(p: Vec2, margin: number): boolean {
    return this.roadGrid.some(p, (d, info) => info.avoidSurface && d < info.road.width / 2 + margin);
  }

  private insideBuilding(p: Vec2): boolean {
    return this.buildingBoxes.some(
      ({ ring, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && pointInRing(p, ring),
    );
  }

  private accept(position: Vec2, rng: () => number): void {
    this.spacing.add(position);
    this.trees.push({ position, scale: round3(randomBetween(rng, ...TREE_SCALE_RANGE)) });
  }
}

/** Point and unit direction at a distance along a polyline. */
function pointAtDistance(points: Vec2[], target: number): { point: Vec2; direction: Vec2 } {
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segment = distance(points[i], points[i + 1]);
    if (segment === 0) continue;
    if (walked + segment >= target || i === points.length - 2) {
      const t = Math.min(1, Math.max(0, (target - walked) / segment));
      return { point: lerp(points[i], points[i + 1], t), direction: scale(sub(points[i + 1], points[i]), 1 / segment) };
    }
    walked += segment;
  }
  return { point: points[0], direction: [1, 0] };
}

function leftNormal(d: Vec2): Vec2 {
  return [-d[1], d[0]];
}

function boundingBox(ring: Ring): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}
