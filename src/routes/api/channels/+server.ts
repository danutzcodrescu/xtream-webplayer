import { json, error } from "@sveltejs/kit";
import { XtreamApi } from "$lib/server/xtream";
import { getPlaylistWithCreds } from "$lib/server/playlist";
import { channelCache } from "$lib/server/cache";
import { logger } from "$lib/server/logger";
import type { RequestHandler } from "./$types";

const log = logger.child({ module: "channels" });

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);

  const playlistId = url.searchParams.get("playlistId");
  const categoryId = url.searchParams.get("categoryId") ?? undefined;
  if (!playlistId) error(400, "playlistId required");

  const cacheKey = `${playlistId}:${categoryId ?? ""}`;
  const cached = channelCache.get(cacheKey);
  if (cached) {
    log.debug({ playlistId, categoryId, count: cached.length }, "channels cache hit");
    return json(cached);
  }

  const creds = await getPlaylistWithCreds(playlistId, locals.user.id);
  if (!creds) error(404, "Playlist not found");

  log.debug({ playlistId, categoryId }, "fetching channels");
  const api = new XtreamApi(creds);
  const streams = await api.getLiveStreams(categoryId);
  channelCache.set(cacheKey, streams);
  log.debug({ playlistId, categoryId, count: streams.length }, "channels fetched and cached");
  return json(streams);
};
