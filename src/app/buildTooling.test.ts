import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("npm run typecheck", () => {
  // layout.tsx types its props with LayoutProps, a global that only exists in
  // files Next generates (next-env.d.ts and .next/types), both gitignored. On a
  // fresh clone a bare `tsc` fails on correct code, so the script has to
  // generate them first, and chain with `&&` so a failed generation stops it.
  it("generates Next's types before running tsc", () => {
    const steps = packageJson.scripts.typecheck.split("&&").map((step) => step.trim());
    const typegen = steps.indexOf("next typegen");

    expect(typegen).toBeGreaterThanOrEqual(0);
    expect(steps.findIndex((step) => step.startsWith("tsc"))).toBeGreaterThan(typegen);
  });
});

describe("npm run lint", () => {
  // public/vendor holds MapLibre's minified worker, copied there by
  // scripts/copy-maplibre-worker.mjs. Linting it reports over a thousand
  // warnings that are not ours to fix and that bury the real ones.
  // The timeout leaves room to load the real config and all of Next's plugins
  // on a cold start. It takes under 2 s on an idle machine, but once took 80 s
  // while the machine was busy, so the margin is generous on purpose.
  it("skips the generated MapLibre worker but still lints our own code", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: projectRoot });
    const isIgnored = (file: string) => eslint.isPathIgnored(path.join(projectRoot, file));

    expect(await isIgnored("public/vendor/maplibre-gl-worker-6.19.0.mjs")).toBe(true);
    expect(await isIgnored("scripts/copy-maplibre-worker.mjs")).toBe(false);
    expect(await isIgnored("src/app/layout.tsx")).toBe(false);
  });
});
