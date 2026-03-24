import { json, error } from "@sveltejs/kit";
import { XtreamApi } from "$lib/server/xtream";
import { getPlaylistWithCreds } from "$lib/server/playlist";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);

  const playlistId = url.searchParams.get("playlistId");
  const categoryId = url.searchParams.get("categoryId") ?? undefined;
  if (!playlistId) error(400, "playlistId required");

  const creds = await getPlaylistWithCreds(playlistId, locals.user.id);
  if (!creds) error(404, "Playlist not found");

  const api = new XtreamApi(creds);
  const streams = await api.getLiveStreams(categoryId);
  return json(streams);
};
