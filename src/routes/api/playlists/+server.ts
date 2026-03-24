import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { playlist } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { XtreamApi } from "$lib/server/xtream";
import { encrypt } from "$lib/server/crypto";
import type { RequestHandler } from "./$types";

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

  // Credentials are NOT returned — only safe fields
  return json(rows);
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) error(401);

  const body = await request.json();
  const { name, serverUrl, xtreamUsername, xtreamPassword } = body as Record<string, string>;

  if (!name || !serverUrl || !xtreamUsername || !xtreamPassword) {
    error(400, "Missing required fields");
  }

  // Validate credentials against the Xtream server before storing
  const api = new XtreamApi({ serverUrl, username: xtreamUsername, password: xtreamPassword });
  const info = await api.authenticate().catch(() => null);
  if (!info || info.user_info.auth !== 1) {
    error(400, "Invalid Xtream credentials or server unreachable");
  }

  const [row] = await db
    .insert(playlist)
    .values({
      userId: locals.user.id,
      name,
      serverUrl: serverUrl.replace(/\/$/, ""),
      xtreamUsername: encrypt(xtreamUsername),
      xtreamPassword: encrypt(xtreamPassword),
    })
    .returning({
      id: playlist.id,
      name: playlist.name,
      serverUrl: playlist.serverUrl,
      createdAt: playlist.createdAt,
    });

  return json(row, { status: 201 });
};
