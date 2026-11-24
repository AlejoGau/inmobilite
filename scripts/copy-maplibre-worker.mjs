// Copies MapLibre's Web Worker into public/vendor, versioned, so the app can
// serve it from its own origin (see src/features/flight/maplibreWorker.ts).
// Runs automatically on `npm run dev` and `npm run build` (predev / prebuild).

import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("maplibre-gl/package.json");
const { version } = require(packageJsonPath);

const source = path.join(path.dirname(packageJsonPath), "dist", "maplibre-gl-worker.mjs");
const targetDir = path.join(process.cwd(), "public", "vendor");
const targetName = `maplibre-gl-worker-${version}.mjs`;

mkdirSync(targetDir, { recursive: true });

// Drop workers from other versions so a stale copy is never served.
for (const file of readdirSync(targetDir)) {
  if (/^maplibre-gl-worker-.+\.mjs$/.test(file) && file !== targetName) {
    rmSync(path.join(targetDir, file));
  }
}

copyFileSync(source, path.join(targetDir, targetName));
console.log(`[maplibre] worker ${version} -> public/vendor/${targetName}`);
