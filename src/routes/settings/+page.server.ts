import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { playlist } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "$lib/server/crypto";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, "/login");

  const rows = await db
    .select({
      id: playlist.id,
      name: playlist.name,
      serverUrl: playlist.serverUrl,
      createdAt: playlist.createdAt,
    })
    .from(playlist)
    .where(eq(playlist.userId, locals.user.id));

  return {
    playlists: rows.map((r) => ({ ...r, serverUrl: decrypt(r.serverUrl) })),
    user: {
      id: locals.user.id,
      name: locals.user.name,
      role: (locals.user as { role?: string }).role ?? "user",
    },
  };
};
