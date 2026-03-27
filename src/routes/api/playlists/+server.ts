import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { playlist } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { XtreamApi } from "$lib/server/xtream";
import { encrypt, decrypt } from "$lib/server/crypto";
import { logger } from "$lib/server/logger";
import type { RequestHandler } from "./$types";

const log = logger.child({ module: "playlists" });

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401);

  const rows = await db
    .select({
      id: playlist.id,
      name: playlist.name,
      serverUrl: playlist.serverUrl,
      createdAt: playlist.createdAt,
    })
    .from(playlist)
    .where(eq(playlist.userId, locals.user.id));

  return json(rows.map((r) => ({ ...r, serverUrl: decrypt(r.serverUrl) })));
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) error(401);

  const body = await request.json();
  const { name, serverUrl, xtreamUsername, xtreamPassword } = body as Record<string, string>;

  if (!name || !serverUrl || !xtreamUsername || !xtreamPassword) {
    error(400, "Missing required fields");
  }

  // Validate credentials against the Xtream server before storing
  log.debug({ userId: locals.user.id, name }, "validating xtream credentials");
  const api = new XtreamApi({ serverUrl, username: xtreamUsername, password: xtreamPassword });
  const info = await api.authenticate().catch(() => null);
  if (!info || info.user_info.auth !== 1) {
    log.warn({ userId: locals.user.id, name }, "invalid xtream credentials or server unreachable");
    error(400, "Invalid Xtream credentials or server unreachable");
  }

  const [row] = await db
    .insert(playlist)
    .values({
      userId: locals.user.id,
      name,
      serverUrl: encrypt(serverUrl.replace(/\/$/, "")),
      xtreamUsername: encrypt(xtreamUsername),
      xtreamPassword: encrypt(xtreamPassword),
    })
    .returning({
      id: playlist.id,
      name: playlist.name,
      serverUrl: playlist.serverUrl,
      createdAt: playlist.createdAt,
    });

  log.info({ userId: locals.user.id, playlistId: row.id, name }, "playlist created");
  return json({ ...row, serverUrl: decrypt(row.serverUrl) }, { status: 201 });
};
