import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeocodeResult } from "@/domain/types";
import { interact, renderForTest, textOf, type TestNode, type TestRoot } from "@/ui/testing/testRenderer";
import { SearchBox } from "./SearchBox";

const ACOYTE: GeocodeResult = { id: "usig:acoyte", label: "Av. Acoyte y Av. Rivadavia", lat: -34.6183, lng: -58.43646, kind: "intersection", provider: "usig" };
const CABILDO: GeocodeResult = { id: "usig:cabildo", label: "Av. Cabildo y Juramento", lat: -34.5627, lng: -58.4565, kind: "intersection", provider: "usig" };
const TYPED_RESULTS = [ACOYTE];

const geocoder = vi.hoisted(() => ({ fetchGeocode: vi.fn() }));
vi.mock("./geocodeClient", () => ({
  fetchGeocode: geocoder.fetchGeocode,
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  MIN_QUERY_LENGTH: 3,
}));
// The typed search answers at once (the server's geocode cache): what matters here is the chip.
vi.mock("./useGeocodeSearch", () => ({
  useGeocodeSearch: (query: string) =>
    query.trim().length >= 3 ? { status: "ready", results: TYPED_RESULTS } : { status: "idle", results: [] },
}));
vi.mock("./useSlashShortcut", () => ({ useSlashShortcut: () => {} }));

/** A geocoder request that hangs until the test answers it, like a slow provider. */
function hangingRequest() {
  let answer!: (results: GeocodeResult[]) => void;
  let signal: AbortSignal | undefined;
  geocoder.fetchGeocode.mockImplementationOnce((_query: string, requestSignal?: AbortSignal) => {
    signal = requestSignal;
    return new Promise<GeocodeResult[]>((resolve) => {
      answer = resolve;
    });
  });
  return { answer: (results: GeocodeResult[]) => answer(results), signal: () => signal };
}

function find(root: TestRoot, predicate: (node: TestNode) => boolean, what: string): TestNode {
  const [match] = root.findAll(predicate);
  if (!match) throw new Error(`No ${what} in: ${root.text()}`);
  return match;
}

const chip = (root: TestRoot, label: string) => find(root, (n) => n.type === "button" && textOf(n).includes(label), `chip "${label}"`);
const input = (root: TestRoot) => find(root, (n) => n.type === "input", "input");
const option = (root: TestRoot, label: string) => find(root, (n) => n.props.role === "option" && textOf(n).includes(label), `option "${label}"`);

beforeEach(() => {
  geocoder.fetchGeocode.mockReset();
});

describe("SearchBox quick picks", () => {
  it("a slow chip answer never overrides a corner the user typed and picked meanwhile", async () => {
    const onPick = vi.fn();
    const root = await renderForTest(createElement(SearchBox, { variant: "hero", onPick }));
    const chipRequest = hangingRequest();

    await interact(() => (chip(root, "Cabildo y Juramento").props.onClick as () => void)());
    await interact(() => (input(root).props.onChange as (e: unknown) => void)({ target: { value: "acoyte y riva" } }));
    await interact(() => (option(root, ACOYTE.label).props.onClick as () => void)());
    expect(onPick).toHaveBeenCalledWith(ACOYTE);

    // The pick cancels the chip's request...
    expect(chipRequest.signal()?.aborted).toBe(true);
    // ...and an answer that still arrives is dropped.
    await interact(() => chipRequest.answer([CABILDO]));
    expect(onPick).toHaveBeenCalledTimes(1);
    // The chip stops pulsing and the other chips can be used again.
    expect(chip(root, "Cabildo y Juramento").props["aria-busy"]).toBe(false);
    expect(chip(root, "Acoyte y Rivadavia").props.disabled).toBe(false);
  });

  it("a chip answer still picks when nothing superseded it", async () => {
    const onPick = vi.fn();
    const root = await renderForTest(createElement(SearchBox, { variant: "hero", onPick }));
    const chipRequest = hangingRequest();

    await interact(() => (chip(root, "Cabildo y Juramento").props.onClick as () => void)());
    await interact(() => chipRequest.answer([CABILDO]));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(CABILDO);
  });
});
