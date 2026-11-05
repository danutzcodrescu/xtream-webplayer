import { error } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
import { StreamProxy } from "$lib/server/stream-proxy";
import type { RequestHandler } from "./$types";

const proxy = new StreamProxy((userId, playlistId) => playlistData.credentials(userId, playlistId));

export const GET: RequestHandler = ({ url, locals }) => {
  if (!locals.user) error(401);
  return proxy.respond(url, locals.user.id);
};
