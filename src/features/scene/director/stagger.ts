/**
 * Staggered reveals: one global 0..1 progress from the director, and per item
 * a delay in the same 0..1 units. Every item animates over the same window,
 * `1 - spread` long, so the last one lands exactly when the global hits 1.
 */

export type Ease = (p: number) => number;

/** Normalises distances to delays in [0, spread]: nearest first, farthest last. */
export function delaysFromDistances(distances: ArrayLike<number>, spread: number, jitter?: (index: number) => number): Float64Array {
  const out = new Float64Array(distances.length);
  if (distances.length === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < distances.length; i++) {
    min = Math.min(min, distances[i]);
    max = Math.max(max, distances[i]);
  }
  const range = max - min;
  for (let i = 0; i < distances.length; i++) {
    const normalised = range > 1e-6 ? (distances[i] - min) / range : 0;
    const jittered = jitter ? normalised + jitter(i) : normalised;
    out[i] = Math.min(1, Math.max(0, jittered)) * spread;
  }
  return out;
}

/** Linear local progress of one item, 0 before its delay and 1 once its window is over. */
export function localProgress(global: number, delay: number, spread: number): number {
  const window = 1 - spread;
  if (window <= 0) return global >= delay ? 1 : 0;
  // The last item must land exactly on 1, not on 1 - epsilon.
  if (global >= delay + window - 1e-7) return 1;
  return Math.max(0, (global - delay) / window);
}

export function staggered(global: number, delay: number, spread: number, ease: Ease): number {
  const p = localProgress(global, delay, spread);
  return p <= 0 ? 0 : p >= 1 ? 1 : ease(p);
}
