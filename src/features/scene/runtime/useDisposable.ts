"use client";

import { useEffect, useMemo, type DependencyList } from "react";

interface Disposable {
  dispose(): void;
}

/**
 * useMemo for GPU resources: builds once per dependency change and disposes
 * the previous value. Disposing only frees GPU memory, so if React re-runs
 * effects on a still-used object (StrictMode), three simply re-uploads it.
 */
export function useDisposable<T extends Disposable | Disposable[]>(factory: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are forwarded from the caller, like useMemo.
  const value = useMemo(factory, deps);
  useEffect(
    () => () => {
      for (const item of Array.isArray(value) ? value : [value]) item.dispose();
    },
    [value],
  );
  return value;
}
