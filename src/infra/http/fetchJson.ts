import type { z } from "zod";

export const USER_AGENT = "inmobilite-demo/0.1";

export class UpstreamError extends Error {
  override name = "UpstreamError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface FetchJsonOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  init?: RequestInit;
}

/**
 * fetch + timeout + zod validation. Every response from outside is
 * validated: a provider changing its shape must surface as a clean
 * UpstreamError, never as a crash deep inside the domain.
 */
export async function fetchJson<S extends z.ZodType>(
  url: string,
  schema: S,
  { timeoutMs, signal, init }: FetchJsonOptions,
): Promise<z.infer<S>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...init?.headers },
      signal: combined,
      cache: "no-store",
    });
  } catch (error) {
    // A caller abort must propagate as-is so the route stops work; a timeout is just a failed upstream.
    if (signal?.aborted) throw error;
    throw new UpstreamError(timeout.aborted ? `Timeout after ${timeoutMs} ms: ${url}` : `Network error: ${url}`);
  }

  if (!response.ok) throw new UpstreamError(`HTTP ${response.status} from ${url}`, response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new UpstreamError(`Invalid or truncated JSON from ${url}`, response.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new UpstreamError(`Unexpected response shape from ${url}: ${parsed.error.message}`);
  return parsed.data;
}
