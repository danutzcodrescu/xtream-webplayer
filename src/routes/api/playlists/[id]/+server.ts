import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { playlist } from "$lib/server/db/schema";
import { and, eq } from "drizzle-orm";
import { encrypt } from "$lib/server/crypto";
import { invalidateEpgCache } from "$lib/server/epg";
import type { RequestHandler } from "./$types";

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
  return json({ id: row.id, name: row.name, serverUrl: row.serverUrl, createdAt: row.createdAt });
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
      ...(serverUrl && { serverUrl: serverUrl.replace(/\/$/, "") }),
      ...(xtreamUsername && { xtreamUsername: encrypt(xtreamUsername) }),
      ...(xtreamPassword && { xtreamPassword: encrypt(xtreamPassword) }),
    })
    .where(and(eq(playlist.id, params.id), eq(playlist.userId, locals.user.id)))
    .returning({ id: playlist.id, name: playlist.name, serverUrl: playlist.serverUrl });

  invalidateEpgCache(params.id);
  return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) error(401);
  const row = await getOwned(params.id, locals.user.id);
  if (!row) error(404);

  await db
    .delete(playlist)
    .where(and(eq(playlist.id, params.id), eq(playlist.userId, locals.user.id)));

  invalidateEpgCache(params.id);
  return new Response(null, { status: 204 });
};
