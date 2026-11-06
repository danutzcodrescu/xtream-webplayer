import { error } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
import { providerUnavailable } from "$lib/server/provider-response";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);
  const id = url.searchParams.get("playlistId");
  const streamId = Number(url.searchParams.get("streamId"));
  if (
    !id ||
    !url.searchParams.has("streamId") ||
    !Number.isSafeInteger(streamId) ||
    streamId <= 0
  ) {
    error(400, "Valid playlistId and streamId required");
  }
  try {
    const result = await playlistData.epgWithStatus(locals.user.id, id, streamId);
    return Response.json(result.value, {
      headers: {
        "Cache-Control": "no-store",
        "X-EPG-Stale": String(result.stale),
        "X-EPG-Expires-At": String(result.expiresAt),
        "X-Provider-Cooldown": String(result.cooldown ?? false),
        ...(result.retryAfterMs && {
          "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
        }),
      },
    });
  } catch (cause) {
    return providerUnavailable(cause, "EPG temporarily unavailable. Please retry.");
  }
};
