import { createElement } from "react";
import type { FlyToOptions, JumpToOptions } from "maplibre-gl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { interact, renderForTest, settle, type TestNode, type TestRoot } from "@/ui/testing/testRenderer";
import { arrivalCamera } from "./camera";
import { GlobeFlight, type FlightTarget } from "./GlobeFlight";

type Listener = (event: { type: string; flightKey?: unknown }) => void;

/**
 * Just enough of MapLibre's camera: like the real one, `flyTo` lands on the zoom
 * it was given at take-off, and a container resize does not stop a flight.
 */
class FakeMap {
  static instances: FakeMap[] = [];
  readonly container: TestNode;
  camera: JumpToOptions;
  private flight: { options: FlyToOptions; eventData?: object } | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(options: JumpToOptions & { container: TestNode }) {
    this.container = options.container;
    this.camera = { center: options.center, zoom: options.zoom, pitch: options.pitch, bearing: options.bearing };
    FakeMap.instances.push(this);
  }

  getContainer = () => this.container;
  getZoom = () => this.camera.zoom ?? 0;
  getCenter = () => ({ lng: 0, lat: 0 });
  setCenter() {}
  setVerticalFieldOfView() {}
  on(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  off(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  isMoving = () => this.flight !== null;
  stop() {
    this.flight = null;
  }
  remove() {}
  jumpTo(options: JumpToOptions) {
    this.flight = null;
    this.camera = { ...this.camera, ...options };
    this.fire("moveend");
  }
  flyTo(options: FlyToOptions, eventData?: object) {
    this.flight = { options, eventData };
  }

  /** Ends the current flight on the pose it was given at take-off. */
  land() {
    if (!this.flight) throw new Error("not flying");
    const { options, eventData } = this.flight;
    this.flight = null;
    this.camera = { ...this.camera, center: options.center, zoom: options.zoom, pitch: options.pitch, bearing: options.bearing };
    this.fire("moveend", eventData);
  }

  /** What MapLibre's ResizeObserver does: new size, same camera, flight untouched. */
  resizeTo(height: number) {
    this.container.clientHeight = height;
    this.fire("resize");
  }

  private fire(type: string, eventData: object = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, ...eventData });
  }
}

vi.mock("maplibre-gl", () => ({ Map: FakeMap, setWorkerUrl: () => {}, getVersion: () => "test" }));
vi.mock("@/ui/usePrefersReducedMotion", () => ({ usePrefersReducedMotion: () => false }));

const ACOYTE = { lng: -58.43646, lat: -34.6183 };
const PORTRAIT = 844;
const LANDSCAPE = 390;

beforeAll(() => {
  // The idle globe spins on requestAnimationFrame; node has none.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  FakeMap.instances = [];
});

function flight(key: number, mode: FlightTarget["mode"] = "fly"): FlightTarget {
  return { key, ...ACOYTE, mode };
}

/** Mounts the idle globe and waits for the (mocked) maplibre import to create the map. */
async function mountGlobe(target: FlightTarget | null, onArrive = vi.fn()): Promise<{ root: TestRoot; map: FakeMap }> {
  const root = await renderForTest(createElement(GlobeFlight, { target, onArrive }));
  await settle(() => vi.waitFor(() => expect(FakeMap.instances).toHaveLength(1)));
  const [map] = FakeMap.instances;
  return { root, map };
}

function expectArrivalScaleFor(map: FakeMap, heightPx: number) {
  expect(map.camera.zoom).toBeCloseTo(arrivalCamera(ACOYTE.lng, ACOYTE.lat, heightPx).zoom ?? NaN, 9);
}

describe("GlobeFlight", () => {
  it("lands at the 3D intro's scale for the viewport it lands in, not the one it took off in", async () => {
    const onArrive = vi.fn();
    const { root, map } = await mountGlobe(null, onArrive);
    map.container.clientHeight = PORTRAIT;
    await root.update(createElement(GlobeFlight, { target: flight(1), onArrive }));

    // The phone rotates mid-flight; MapLibre keeps flying towards the portrait zoom.
    map.resizeTo(LANDSCAPE);
    await interact(() => map.land());

    expect(onArrive).toHaveBeenCalledWith(1);
    expectArrivalScaleFor(map, LANDSCAPE);
  });

  it("keeps the arrival scale when the viewport changes while the area is still loading", async () => {
    const onArrive = vi.fn();
    const { root, map } = await mountGlobe(null, onArrive);
    await root.update(createElement(GlobeFlight, { target: flight(1), onArrive }));
    await interact(() => map.land());

    map.resizeTo(600);
    expectArrivalScaleFor(map, 600);
  });

  it("a deep link keeps the arrival scale on resize too", async () => {
    const { map } = await mountGlobe(flight(1, "jump"));
    map.resizeTo(LANDSCAPE);
    expectArrivalScaleFor(map, LANDSCAPE);
  });

  it("after a new search leaves, a resize no longer pulls the camera back to the old corner", async () => {
    const onArrive = vi.fn();
    const { root, map } = await mountGlobe(null, onArrive);
    await root.update(createElement(GlobeFlight, { target: flight(1), onArrive }));
    await interact(() => map.land());

    // "Nueva búsqueda": the globe flies home.
    await root.update(createElement(GlobeFlight, { target: null, onArrive }));
    map.resizeTo(600);

    // Still flying home, from where it landed (the 900 px default height of the test nodes).
    expect(map.isMoving()).toBe(true);
    expectArrivalScaleFor(map, 900);
  });
});
