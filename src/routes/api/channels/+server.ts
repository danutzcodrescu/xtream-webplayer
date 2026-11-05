import { json, error } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);
  const id = url.searchParams.get("playlistId");
  if (!id) error(400, "playlistId required");
  return json(
    await playlistData.channels(
      locals.user.id,
      id,
      url.searchParams.get("categoryId") ?? undefined,
    ),
  );
};
