import { act, advance, createRoot, events as createPointerEvents, extend, type Catalogue, type RenderProps, type RootStore } from "@react-three/fiber";
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { PerspectiveCamera, type Camera, type Object3D } from "three";
import type { DirectorFrame } from "../director/director";
import { SceneRuntimeProvider, type SceneRuntime } from "../runtime/SceneRuntime";

/**
 * Runs scene components in node inside a real R3F root: no DOM and no WebGL,
 * but R3F's own store, reconciler, root configuration and pointer events.
 * Enough to check how a component copes with what R3F does around it
 * (configuring the root again on every <Canvas> render, booking hovers,
 * sending a click to the objects its press hit) without a browser.
 */

// React flushes effects inside act() only when the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// <Canvas> registers three's classes (<mesh>, <group>...) before its first render; a bare root does not.
extend(THREE as unknown as Catalogue);

// camera-controls keeps its element's bounds in a DOMRect, which node lacks.
class NodeDomRect {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  get left() {
    return this.x;
  }
  get top() {
    return this.y;
  }
  get right() {
    return this.x + this.width;
  }
  get bottom() {
    return this.y + this.height;
  }
}
if (typeof globalThis.DOMRect === "undefined") {
  (globalThis as { DOMRect?: unknown }).DOMRect = NodeDomRect;
}

const noop = () => {};

/** Just enough of an element for R3F's event wiring and camera-controls' listeners. */
export function createFakeElement(width: number, height: number) {
  return {
    style: {} as Record<string, string>,
    setAttribute: noop,
    removeAttribute: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height }),
    ownerDocument: { addEventListener: noop, removeEventListener: noop, exitPointerLock: noop, pointerLockElement: null },
  };
}

export type FakeElement = ReturnType<typeof createFakeElement>;

/** Stands in for WebGLRenderer: draws nothing, but keeps the pixel ratio and updates world matrices like render() does. */
export class FakeRenderer {
  private pixelRatio = 1;

  constructor(readonly domElement: FakeElement) {}

  render(scene: Object3D, camera: Camera): void {
    scene.updateMatrixWorld();
    if (!camera.parent) camera.updateMatrixWorld();
  }

  setPixelRatio(value: number): void {
    this.pixelRatio = value;
  }

  getPixelRatio(): number {
    return this.pixelRatio;
  }

  setSize(): void {}
}

export type PointerEventName = "onPointerMove" | "onPointerDown" | "onPointerUp" | "onClick";

export interface StageHarnessOptions {
  /** Canvas size in CSS pixels. */
  width?: number;
  height?: number;
  /** Root props, as CityStage passes them to <Canvas>. The loop never runs on its own: use frame(). */
  config?: Omit<RenderProps<HTMLCanvasElement>, "gl" | "size" | "events" | "frameloop">;
  /** Wires R3F's pointer events, as <Canvas> does. */
  pointerEvents?: boolean;
}

export interface StageHarness {
  readonly store: RootStore;
  readonly gl: FakeRenderer;
  /** Renders a new tree into the root (a state change inside the scene), with effects flushed. */
  render(element: ReactNode): Promise<void>;
  /**
   * What <Canvas> does on each of its own renders (CityStage re-rendering for a
   * selection, a label toggle, a resize or the end of the intro): configure the
   * root again with the same props, then render.
   */
  rerenderCanvas(element: ReactNode): Promise<void>;
  /** One frame of R3F's loop at `seconds`: useFrame subscribers, then the (fake) render. */
  frame(seconds: number): Promise<void>;
  /** A DOM pointer event at canvas pixel (x, y), through R3F's own handlers. */
  pointer(name: PointerEventName, x: number, y: number): Promise<void>;
  /** Runs outside work that updates the scene (a media query firing, a timer), with effects flushed. */
  act(work: () => void): Promise<void>;
  unmount(): Promise<void>;
}

async function inAct(work: () => void): Promise<void> {
  await act(async () => work());
}

/** The fields R3F reads from a DOM pointer event: where it happened (offsetX/Y) and which pointer. */
function pointerEvent(name: PointerEventName, x: number, y: number): Event {
  return { type: name.slice(2).toLowerCase(), offsetX: x, offsetY: y, clientX: x, clientY: y, pointerId: 1, button: 0 } as unknown as Event;
}

export async function mountStage(element: ReactNode, options: StageHarnessOptions = {}): Promise<StageHarness> {
  const { width = 800, height = 500, config = {}, pointerEvents = false } = options;
  const canvas = createFakeElement(width, height);
  const gl = new FakeRenderer(canvas);
  const root = createRoot(canvas as unknown as HTMLCanvasElement);
  const props: RenderProps<HTMLCanvasElement> = {
    ...config,
    gl,
    size: { width, height, top: 0, left: 0 },
    events: pointerEvents ? createPointerEvents : undefined,
    frameloop: "never",
  };
  let store!: RootStore;
  await inAct(() => {
    void root.configure(props);
    store = root.render(element);
  });
  return {
    get store() {
      return store;
    },
    gl,
    render: (next) =>
      inAct(() => {
        root.render(next);
      }),
    rerenderCanvas: (next) =>
      inAct(() => {
        void root.configure(props);
        root.render(next);
      }),
    frame: (seconds) => inAct(() => advance(seconds, true, store.getState())),
    pointer: (name, x, y) =>
      inAct(() => {
        const handlers = store.getState().events.handlers;
        if (!handlers) throw new Error("Mount the stage with pointerEvents: true to send pointer events");
        handlers[name](pointerEvent(name, x, y));
      }),
    act: inAct,
    unmount: () => inAct(() => root.unmount()),
  };
}

/** `<SceneRuntimeProvider value={runtime}>{scene}</SceneRuntimeProvider>`, for tests written without JSX. */
export function withRuntime(runtime: SceneRuntime, scene: ReactNode): ReactElement {
  // The children go in as createElement's third argument, which the props type cannot see.
  const props = { value: runtime } as ComponentProps<typeof SceneRuntimeProvider>;
  return createElement(SceneRuntimeProvider, props, scene);
}

/** Puts the camera on a director pose, as SceneDriver does during the intro. */
export function placeCamera(camera: Camera, pose: DirectorFrame["camera"]): void {
  const { position, target } = pose;
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);
  if (camera instanceof PerspectiveCamera) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}
