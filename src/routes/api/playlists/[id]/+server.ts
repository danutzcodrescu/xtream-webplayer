import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { playlist } from "$lib/server/db/schema";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "$lib/server/crypto";
import { invalidatePlaylistCache } from "$lib/server/cache";
import { logger } from "$lib/server/logger";
import type { RequestHandler } from "./$types";

const log = logger.child({ module: "playlists" });

async function getOwned(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(playlist)
    .where(and(eq(playlist.id, id), eq(playlist.userId, userId)));
  return row ?? null;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) error(401);
  const row = await getOwned(params.id, locals.user.id);
  if (!row) error(404);
  // Return safe fields only — credentials stay in the DB
  return json({ id: row.id, name: row.name, serverUrl: decrypt(row.serverUrl), createdAt: row.createdAt });
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) error(401);
  const row = await getOwned(params.id, locals.user.id);
  if (!row) error(404);

  const body = (await request.json()) as Record<string, string>;
  const { name, serverUrl, xtreamUsername, xtreamPassword } = body;

  const [updated] = await db
    .update(playlist)
    .set({
      ...(name && { name }),
      ...(serverUrl && { serverUrl: encrypt(serverUrl.replace(/\/$/, "")) }),
      ...(xtreamUsername && { xtreamUsername: encrypt(xtreamUsername) }),
      ...(xtreamPassword && { xtreamPassword: encrypt(xtreamPassword) }),
    })
    .where(and(eq(playlist.id, params.id), eq(playlist.userId, locals.user.id)))
    .returning({ id: playlist.id, name: playlist.name, serverUrl: playlist.serverUrl });

  invalidatePlaylistCache(params.id);
  log.info({ userId: locals.user.id, playlistId: params.id }, "playlist updated");
  return json({ ...updated, serverUrl: decrypt(updated.serverUrl) });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) error(401);
  const row = await getOwned(params.id, locals.user.id);
  if (!row) error(404);

  await db
    .delete(playlist)
    .where(and(eq(playlist.id, params.id), eq(playlist.userId, locals.user.id)));

  invalidatePlaylistCache(params.id);
  log.info({ userId: locals.user.id, playlistId: params.id }, "playlist deleted");
  return new Response(null, { status: 204 });
};
