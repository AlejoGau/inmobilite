import type * as MapLibre from "maplibre-gl";

/**
 * MapLibre resolves its Web Worker relative to its own module URL. The bundler
 * renames that module, so the worker URL 404s and no tile ever renders (the
 * globe stays black). scripts/copy-maplibre-worker.mjs copies the worker into
 * public/vendor with the package version in the file name, on `predev` and
 * `prebuild`. This points MapLibre at that copy.
 *
 * Call it before creating the first Map.
 */
export function configureMaplibreWorker(
  maplibre: Pick<typeof MapLibre, "setWorkerUrl" | "getVersion">,
): void {
  maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibre.getVersion()}.mjs`);
}
