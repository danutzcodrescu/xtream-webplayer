import { error, isHttpError } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
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
    return Response.json(await playlistData.epg(locals.user.id, id, streamId));
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    error(503, "EPG temporarily unavailable. Please retry.");
  }
};
