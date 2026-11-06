import { error } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
import { providerUnavailable } from "$lib/server/provider-response";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);
  const id = url.searchParams.get("playlistId");
  if (!id) error(400, "playlistId required");
  try {
    return Response.json(
      await playlistData.channels(
        locals.user.id,
        id,
        url.searchParams.get("categoryId") ?? undefined,
      ),
    );
  } catch (cause) {
    return providerUnavailable(cause, "Channels temporarily unavailable. Please retry.");
  }
};
