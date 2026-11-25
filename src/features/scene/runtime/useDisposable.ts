"use client";

import { useEffect } from "react";

export interface Disposable {
  dispose(): void;
}

/**
 * Frees GPU resources built with useMemo once they are replaced or the
 * component unmounts. Disposing only releases GPU memory, so if React re-runs
 * effects on a still-used object (StrictMode), three simply re-uploads it.
 */
export function useDisposeOnChange(resource: Disposable | null | undefined): void {
  useEffect(() => () => resource?.dispose(), [resource]);
}

/** Groups several resources under one dispose(). */
export function disposableGroup<T extends Record<string, Disposable | null>>(resources: T): T & Disposable {
  return {
    ...resources,
    dispose() {
      for (const r of Object.values(resources)) r?.dispose();
    },
  };
}
