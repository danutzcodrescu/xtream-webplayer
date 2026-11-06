import { isHttpError } from "@sveltejs/kit";
import { XtreamApiError } from "./provider-scheduler.js";

/** Keep provider details out of browser errors, but preserve access/input errors. */
export function providerUnavailable(cause: unknown, message: string): Response {
  if (isHttpError(cause)) throw cause;
  const delay = Math.max(30_000, cause instanceof XtreamApiError ? cause.retryAfterMs : 0);
  return Response.json(
    { message },
    {
      status: 503,
      headers: {
        "Retry-After": String(Math.ceil(delay / 1000)),
        "X-Provider-Cooldown": String(cause instanceof XtreamApiError && cause.status === 429),
        "Cache-Control": "no-store",
      },
    },
  );
}
