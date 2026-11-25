import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hedgedRace, RaceTimeoutError, type RaceAttempt } from "./hedgedRace";

const STAGGER = 100;
const DEADLINE = 1_000;

/** A scripted attempt: records when it started and whether it was aborted, then answers or fails after `ms`. */
function scripted(outcome: "win" | "fail" | "hang", ms = 0, log: string[] = []) {
  const state = { started: false, aborted: false };
  const attempt: RaceAttempt<string> = (signal) =>
    new Promise((resolve, reject) => {
      state.started = true;
      log.push(`start@${Date.now()}`);
      signal.addEventListener("abort", () => {
        state.aborted = true;
        reject(signal.reason);
      });
      if (outcome === "win") setTimeout(() => resolve(`won after ${ms}`), ms);
      if (outcome === "fail") setTimeout(() => reject(new Error(`failed after ${ms}`)), ms);
    });
  return { attempt, state };
}

describe("hedgedRace", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 0 }));
  afterEach(() => vi.useRealTimers());

  it("starts one attempt at a time, the next only after the stagger, and aborts the losers", async () => {
    const log: string[] = [];
    const slow = scripted("hang", 0, log);
    const fast = scripted("win", 30, log);
    const spare = scripted("win", 0, log);
    const race = hedgedRace([slow.attempt, fast.attempt, spare.attempt], { staggerMs: STAGGER, deadlineMs: DEADLINE });

    await vi.advanceTimersByTimeAsync(STAGGER - 1);
    expect([slow.state.started, fast.state.started]).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(31);

    await expect(race).resolves.toBe("won after 30");
    expect(log).toEqual(["start@0", `start@${STAGGER}`]);
    expect(slow.state.aborted).toBe(true);
    expect(spare.state.started).toBe(false);
  });

  it("starts the next attempt as soon as one fails, without waiting for the stagger", async () => {
    const log: string[] = [];
    const broken = scripted("fail", 5, log);
    const healthy = scripted("win", 5, log);
    const race = hedgedRace([broken.attempt, healthy.attempt], { staggerMs: STAGGER, deadlineMs: DEADLINE });
    await vi.advanceTimersByTimeAsync(10);
    await expect(race).resolves.toBe("won after 5");
    expect(log).toEqual(["start@0", "start@5"]);
  });

  it("rejects with every error when all attempts fail", async () => {
    const race = hedgedRace([scripted("fail", 1).attempt, scripted("fail", 2).attempt], { staggerMs: STAGGER, deadlineMs: DEADLINE });
    const outcome = expect(race).rejects.toSatisfy(
      (error) => error instanceof AggregateError && !(error instanceof RaceTimeoutError) && error.errors.length === 2,
    );
    await vi.advanceTimersByTimeAsync(10);
    await outcome;
  });

  it("gives up at the deadline, aborting everything still running", async () => {
    const attempts = [scripted("hang"), scripted("fail", 10), scripted("hang")];
    const race = hedgedRace(
      attempts.map((a) => a.attempt),
      { staggerMs: STAGGER, deadlineMs: DEADLINE },
    );
    const outcome = expect(race).rejects.toSatisfy(
      (error) => error instanceof RaceTimeoutError && error.errors.length === 1,
    );
    await vi.advanceTimersByTimeAsync(DEADLINE);
    await outcome;
    expect(attempts.map((a) => a.state.started)).toEqual([true, true, true]);
    expect([attempts[0].state.aborted, attempts[2].state.aborted]).toEqual([true, true]);
  });

  it("stops at once when the caller aborts, with the caller's reason", async () => {
    const first = scripted("hang");
    const second = scripted("win");
    const controller = new AbortController();
    const race = hedgedRace([first.attempt, second.attempt], { staggerMs: STAGGER, deadlineMs: DEADLINE, signal: controller.signal });
    controller.abort(new Error("visitor left"));
    await expect(race).rejects.toThrow("visitor left");
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(first.state.aborted).toBe(true);
    expect(second.state.started).toBe(false);
  });

  it("does not start anything for a caller that already gave up", async () => {
    const only = scripted("win");
    const controller = new AbortController();
    controller.abort();
    await expect(hedgedRace([only.attempt], { staggerMs: STAGGER, deadlineMs: DEADLINE, signal: controller.signal })).rejects.toHaveProperty(
      "name",
      "AbortError",
    );
    expect(only.state.started).toBe(false);
  });
});
