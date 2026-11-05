import { json, error } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401);
  const id = url.searchParams.get("playlistId");
  if (!id) error(400, "playlistId required");
  return json(await playlistData.categories(locals.user.id, id));
};

export const PUT: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) error(401);
  const body = await request.json();
  if (!body || typeof body.playlistId !== "string") error(400, "playlistId required");
  await playlistData.saveCategoryOrder(locals.user.id, body.playlistId, body.categories);
  return json({ ok: true });
};
