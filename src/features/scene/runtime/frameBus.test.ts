import { describe, expect, it } from "vitest";
import { createEmptyFrame } from "../director/director";
import { FrameBus } from "./frameBus";

describe("frame bus", () => {
  it("replays the current frame on subscribe, fans out publishes, and unsubscribes", () => {
    const first = createEmptyFrame();
    const bus = new FrameBus(first);
    const seen: number[] = [];
    const off = bus.subscribe((f) => seen.push(f.t));
    expect(seen).toEqual([0]);
    const next = { ...createEmptyFrame(), t: 1.5 };
    bus.publish(next);
    expect(seen).toEqual([0, 1.5]);
    expect(bus.current).toBe(next);
    off();
    bus.publish({ ...next, t: 2 });
    expect(seen).toEqual([0, 1.5]);
  });

  it("lets a listener unsubscribe while a publish is running", () => {
    const bus = new FrameBus(createEmptyFrame());
    const calls: string[] = [];
    let armed = false;
    const offA = bus.subscribe(() => {
      calls.push("a");
      if (armed) offA();
    });
    armed = true;
    bus.subscribe(() => calls.push("b"));
    calls.length = 0;
    bus.publish(createEmptyFrame());
    bus.publish(createEmptyFrame());
    expect(calls).toEqual(["a", "b", "b"]);
  });
});
