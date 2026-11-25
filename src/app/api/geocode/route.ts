import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { errorResult, toResponse } from "@/infra/api/apiResult";
import { geocodeHandler } from "@/infra/api/geocodeHandler";

/**
 * GET /api/geocode?q=acoyte y riva → GeocodeResponse.
 * Reading searchParams makes this request-time under cacheComponents, so no
 * segment config is needed (and `dynamic` / `runtime` are not allowed there).
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    return toResponse(await geocodeHandler(request.nextUrl.searchParams.get("q"), request.signal));
  } catch (error) {
    // Next's own control-flow errors (the prerender bail-out on searchParams) must go through.
    unstable_rethrow(error);
    // The client navigated away or typed further; nobody is waiting for this answer.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[api/geocode]", error);
    return toResponse(errorResult(500, "Error inesperado del buscador."));
  }
}
