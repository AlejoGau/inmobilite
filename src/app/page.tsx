import { Suspense } from "react";
import { Experience, ExperienceFallback } from "@/features/experience";

/**
 * Thin on purpose. The experience reads the URL (deep links) with
 * useSearchParams, so under Cache Components it sits in a Suspense boundary:
 * the static hero is prerendered and the live app takes over in the browser.
 */
export default function Home() {
  return (
    <Suspense fallback={<ExperienceFallback />}>
      <Experience />
    </Suspense>
  );
}
