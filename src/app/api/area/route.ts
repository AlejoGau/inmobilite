import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { errorResult, toResponse } from "@/infra/api/apiResult";
import { areaHandler } from "@/infra/api/areaHandler";

/**
 * GET /api/area?lat=-34.6183&lng=-58.43646 → AreaModel | AreaErrorResponse.
 * Request-time under cacheComponents because it reads searchParams; the
 * in-memory LRU in the handler does the caching.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  try {
    return toResponse(await areaHandler(params.get("lat"), params.get("lng")));
  } catch (error) {
    // Next's own control-flow errors (the prerender bail-out on searchParams) must go through.
    unstable_rethrow(error);
    console.error("[api/area]", error);
    return toResponse(errorResult(500, "Error inesperado al armar la zona."));
  }
}
