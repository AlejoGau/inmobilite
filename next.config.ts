import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The offline fallback of /api/area reads saved tiles with fs at runtime; tracing does not see
  // those reads, so the fixtures are included explicitly or a deployment would ship without them.
  outputFileTracingIncludes: {
    "/api/area": ["./src/infra/gcba/__fixtures__/**/*", "./src/infra/openfreemap/__fixtures__/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
