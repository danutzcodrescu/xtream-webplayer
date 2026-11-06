import { error } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401);
  return Response.json(await playlistData.list(locals.user.id));
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) error(401);
  return Response.json(await playlistData.create(locals.user.id, await request.json()), {
    status: 201,
  });
};
