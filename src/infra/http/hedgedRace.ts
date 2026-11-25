/**
 * One attempt of a race. It must settle (reject) once `signal` aborts: the race aborts every attempt
 * still running when it has a winner, runs out of time or the caller gives up.
 */
export type RaceAttempt<T> = (signal: AbortSignal) => Promise<T>;

export interface HedgedRaceOptions {
  /** While nothing has answered, the next attempt starts this long after the last one started. */
  staggerMs: number;
  /** The whole race gives up after this long. */
  deadlineMs: number;
  /** The caller's cancellation. */
  signal?: AbortSignal;
}

/** The deadline passed with no success. `errors` holds the attempts that had failed by then. */
export class RaceTimeoutError extends AggregateError {
  override name = "RaceTimeoutError";
}

/**
 * Runs interchangeable attempts, such as the same request to several mirrors, so that a dead or hung
 * one cannot hold up the answer:
 * - the first attempt starts at once, and the next one as soon as one fails, or `staggerMs` after the
 *   last start if nothing has answered by then;
 * - the first success wins, and every attempt still running is aborted;
 * - it rejects with an AggregateError when every attempt fails, a RaceTimeoutError after `deadlineMs`,
 *   or the caller's abort reason as soon as `signal` aborts.
 * Staggering, rather than starting everything at once, keeps a healthy first mirror at one request
 * instead of multiplying the load on public servers that are often at capacity.
 */
export function hedgedRace<T>(attempts: readonly RaceAttempt<T>[], options: HedgedRaceOptions): Promise<T> {
  const { staggerMs, deadlineMs, signal } = options;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    if (attempts.length === 0) return reject(new AggregateError([], "Nothing to race"));

    const running = new AbortController();
    const errors: unknown[] = [];
    let started = 0;
    let settled = false;
    let staggerTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(staggerTimer);
      clearTimeout(deadlineTimer);
      signal?.removeEventListener("abort", onCallerAbort);
      running.abort();
      finish();
    };
    const onCallerAbort = (): void => settle(() => reject(signal?.reason));

    const startNext = (): void => {
      clearTimeout(staggerTimer);
      if (settled || started === attempts.length) return;
      const attempt = attempts[started++];
      if (started < attempts.length) staggerTimer = setTimeout(startNext, staggerMs);
      // The executor runs now, and turns a synchronous throw into just another failed attempt.
      new Promise<T>((run) => run(attempt(running.signal))).then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => {
          errors.push(error);
          if (errors.length === attempts.length) settle(() => reject(new AggregateError(errors, "Every attempt failed")));
          else startNext();
        },
      );
    };

    const deadlineTimer = setTimeout(
      () => settle(() => reject(new RaceTimeoutError(errors, `No answer within ${deadlineMs} ms`))),
      deadlineMs,
    );
    signal?.addEventListener("abort", onCallerAbort, { once: true });
    startNext();
  });
}
