import { error } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) error(401);
  return Response.json(await playlistData.get(locals.user.id, params.id));
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) error(401);
  return Response.json(await playlistData.update(locals.user.id, params.id, await request.json()));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) error(401);
  await playlistData.delete(locals.user.id, params.id);
  return new Response(null, { status: 204 });
};
