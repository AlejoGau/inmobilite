import type { AreaErrorResponse } from "@/domain/types";

/**
 * Framework-free handler output. Route files only turn it into a Response,
 * so every branch of the API logic is unit-testable without Next.
 */
export interface ApiResult<T> {
  status: number;
  body: T | AreaErrorResponse;
  headers: Record<string, string>;
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function errorResult(status: number, error: string): ApiResult<never> {
  return { status, body: { error }, headers: { ...NO_STORE } };
}

export function toResponse<T>(result: ApiResult<T>): Response {
  return Response.json(result.body, { status: result.status, headers: result.headers });
}
