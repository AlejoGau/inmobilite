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
    // The client navigated away or typed further; nobody is waiting for this answer.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[api/geocode]", error);
    return toResponse(errorResult(500, "Error inesperado del buscador."));
  }
}
