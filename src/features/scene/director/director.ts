import { gsap } from "gsap";
import { mulberry32 } from "@/domain/seed";
import type { AreaModel } from "@/domain/types";
import { heroPose, orbitPosition, startPose, type OrbitPose, type Vec3 } from "./cameraPose";
import { delaysFromDistances, staggered, type Ease } from "./stagger";

/**
 * Everything the scene needs to draw one instant of the intro. Visual
 * components are pure functions of this frame: they never read a clock.
 */
export interface DirectorFrame {
  /** Seconds since the play started. Keeps growing after the intro (ambient loops use it). */
  t: number;
  /** Intro progress, 0..1. */
  progress: number;
  camera: { position: Vec3; target: Vec3; fov: number };
  groundReveal: number;
  roadsReveal: number;
  markingsReveal: number;
  /** Global rise progress; each building applies its own delay (see Director.buildingRise). */
  buildingRise: number;
  treesReveal: number;
  labels: number;
  beacon: number;
}

export interface Director {
  /** Intro length in seconds. */
  duration: number;
  /** Pure: same t, same frame. Allocates a new frame. */
  sample(t: number): DirectorFrame;
  /** Same as sample, writing into `out` (no allocation, for the render loop). */
  sampleInto(t: number, out: DirectorFrame): DirectorFrame;
  readonly start: OrbitPose;
  readonly end: OrbitPose;
  /** Eased 0..1 rise of building `index` (same order as area.buildings). */
  buildingRise(index: number, frame: DirectorFrame): number;
  /** Linear 0..1 rise window of building `index`, for effects that peak mid-rise. */
  buildingRiseLinear(index: number, frame: DirectorFrame): number;
  /** Eased pop (with a little overshoot) of tree `index` (same order as area.trees). */
  treePop(index: number, frame: DirectorFrame): number;
  /**
   * Kills the GSAP timeline; the director must not be used afterwards. Optional:
   * the timeline is detached from GSAP's global clock, so an unused director
   * is simply garbage collected.
   */
  dispose(): void;
}

export interface DirectorOptions {
  /** Viewport aspect used to frame the hero shot. */
  aspect?: number;
}

export const INTRO_DURATION = 8.2;

/** Fraction of each global progress spent staggering items (the rest is each item's own animation). */
export const BUILDING_STAGGER = 0.55;
export const TREE_STAGGER = 0.7;
const TREE_JITTER = 0.06;

interface Proxy {
  bearing: number;
  polar: number;
  distance: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
  groundReveal: number;
  roadsReveal: number;
  markingsReveal: number;
  buildingRise: number;
  treesReveal: number;
  labels: number;
  beacon: number;
}

type ProxyKey = keyof Proxy;

/**
 * The choreography, in seconds. Each proxy property is driven by exactly one
 * tween, which keeps seeking order-independent. The camera parameters use
 * staggered starts and different eases, so the descent reads as an arc: it
 * drops first, then tilts and swings around into the 3/4 view.
 */
const CHOREOGRAPHY: Array<{ keys: ProxyKey[]; at: number; duration: number; ease: string }> = [
  { keys: ["distance"], at: 0.2, duration: 7.4, ease: "power3.inOut" },
  { keys: ["bearing"], at: 0.3, duration: 7.7, ease: "power2.inOut" },
  { keys: ["polar"], at: 0.9, duration: 7.1, ease: "power2.inOut" },
  { keys: ["tx", "ty", "tz"], at: 0.6, duration: 7.2, ease: "power2.inOut" },
  { keys: ["fov"], at: 0.5, duration: 7.0, ease: "sine.inOut" },
  { keys: ["groundReveal"], at: 0.15, duration: 2.45, ease: "power2.out" },
  { keys: ["roadsReveal"], at: 0.7, duration: 2.8, ease: "power2.out" },
  { keys: ["markingsReveal"], at: 1.5, duration: 2.9, ease: "power1.out" },
  // Global stagger clocks: items apply their own expressive ease on top.
  { keys: ["buildingRise"], at: 2.3, duration: 4.6, ease: "power1.inOut" },
  { keys: ["treesReveal"], at: 3.4, duration: 3.8, ease: "power1.inOut" },
  { keys: ["beacon"], at: 5.4, duration: 1.6, ease: "power2.out" },
  { keys: ["labels"], at: 6.0, duration: 1.9, ease: "power2.out" },
];

function proxyFrom(start: OrbitPose): Proxy {
  return {
    bearing: start.bearingDeg,
    polar: start.polarDeg,
    distance: start.distance,
    tx: start.target[0],
    ty: start.target[1],
    tz: start.target[2],
    fov: start.fovDeg,
    groundReveal: 0,
    roadsReveal: 0,
    markingsReveal: 0,
    buildingRise: 0,
    treesReveal: 0,
    labels: 0,
    beacon: 0,
  };
}

function proxyTo(end: OrbitPose): Proxy {
  return {
    bearing: end.bearingDeg,
    polar: end.polarDeg,
    distance: end.distance,
    tx: end.target[0],
    ty: end.target[1],
    tz: end.target[2],
    fov: end.fovDeg,
    groundReveal: 1,
    roadsReveal: 1,
    markingsReveal: 1,
    buildingRise: 1,
    treesReveal: 1,
    labels: 1,
    beacon: 1,
  };
}

function pick(source: Proxy, keys: ProxyKey[]): Partial<Proxy> {
  const out: Partial<Proxy> = {};
  for (const k of keys) out[k] = source[k];
  return out;
}

/**
 * GSAP writes interpolated numbers rounded to 1e-6. Snapping the keyframes to
 * the same grid makes a never-rendered tween (still holding its initial
 * value) indistinguishable from one rendered back to its start, so sample(t)
 * returns the exact same frame whatever was sampled before.
 */
function snapToGsapPrecision(proxy: Proxy): Proxy {
  const out = { ...proxy };
  for (const key of Object.keys(out) as ProxyKey[]) out[key] = Math.round(out[key] * 1e6) / 1e6;
  return out;
}

export function createEmptyFrame(): DirectorFrame {
  return {
    t: 0,
    progress: 0,
    camera: { position: [0, 0, 0], target: [0, 0, 0], fov: 50 },
    groundReveal: 0,
    roadsReveal: 0,
    markingsReveal: 0,
    buildingRise: 0,
    treesReveal: 0,
    labels: 0,
    beacon: 0,
  };
}

export function createDirector(area: AreaModel, options: DirectorOptions = {}): Director {
  const start = startPose();
  const end = heroPose(area, options.aspect);
  const from = snapToGsapPrecision(proxyFrom(start));
  const to = snapToGsapPrecision(proxyTo(end));
  const proxy: Proxy = { ...from };

  const timeline = gsap.timeline({ paused: true });
  // Detached from GSAP's global clock: only sample() moves it.
  gsap.globalTimeline.remove(timeline);
  for (const step of CHOREOGRAPHY) {
    timeline.fromTo(
      proxy,
      pick(from, step.keys),
      { ...pick(to, step.keys), duration: step.duration, ease: step.ease, immediateRender: false, lazy: false },
      step.at,
    );
  }

  const buildingDelays = delaysFromDistances(
    area.buildings.map((b) => b.distance),
    BUILDING_STAGGER,
  );
  const treeRng = mulberry32(area.seed ^ 0x68e31da4);
  const treeJitter = area.trees.map(() => (treeRng() * 2 - 1) * TREE_JITTER);
  const treeDelays = delaysFromDistances(
    area.trees.map((tree) => Math.hypot(tree.position[0], tree.position[1])),
    TREE_STAGGER,
    (i) => treeJitter[i],
  );
  const riseEase = gsap.parseEase("expo.out") as Ease;
  const popEase = gsap.parseEase("back.out(1.7)") as Ease;
  const timelineEnd = timeline.duration();

  const sampleInto = (t: number, out: DirectorFrame): DirectorFrame => {
    const time = Math.min(Math.max(t, 0), INTRO_DURATION);
    // suppressEvents = true: seeking must never fire callbacks.
    timeline.seek(Math.min(time, timelineEnd), true);
    out.t = Math.max(t, 0);
    out.progress = time / INTRO_DURATION;
    const target = out.camera.target;
    target[0] = proxy.tx;
    target[1] = proxy.ty;
    target[2] = proxy.tz;
    orbitPosition(proxy.bearing, proxy.polar, proxy.distance, target, out.camera.position);
    out.camera.fov = proxy.fov;
    out.groundReveal = proxy.groundReveal;
    out.roadsReveal = proxy.roadsReveal;
    out.markingsReveal = proxy.markingsReveal;
    out.buildingRise = proxy.buildingRise;
    out.treesReveal = proxy.treesReveal;
    out.labels = proxy.labels;
    out.beacon = proxy.beacon;
    return out;
  };

  return {
    duration: INTRO_DURATION,
    start,
    end,
    sample: (t) => sampleInto(t, createEmptyFrame()),
    sampleInto,
    buildingRise: (index, frame) => staggered(frame.buildingRise, buildingDelays[index] ?? 0, BUILDING_STAGGER, riseEase),
    buildingRiseLinear: (index, frame) => staggered(frame.buildingRise, buildingDelays[index] ?? 0, BUILDING_STAGGER, (p) => p),
    treePop: (index, frame) => staggered(frame.treesReveal, treeDelays[index] ?? 0, TREE_STAGGER, popEase),
    dispose: () => {
      timeline.kill();
    },
  };
}
