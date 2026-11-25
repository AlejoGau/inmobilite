import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The 3D scene has a single clock: SceneDriver. Everything else animates
  // from the director frame (useDirectorFrame), never from useFrame.
  {
    files: ["src/features/scene/**/*.{ts,tsx}"],
    ignores: ["src/features/scene/runtime/SceneDriver.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@react-three/fiber",
              importNames: ["useFrame"],
              message: "Only runtime/SceneDriver.tsx may use useFrame. Animate from the director with useDirectorFrame().",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MapLibre's minified worker, copied in by scripts/copy-maplibre-worker.mjs.
    // It is generated and not ours to fix: linting it adds 1000+ warnings.
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
