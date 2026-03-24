import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { playlist } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, "/login");

  const playlists = await db
    .select({
      id: playlist.id,
      name: playlist.name,
      serverUrl: playlist.serverUrl,
    })
    .from(playlist)
    .where(eq(playlist.userId, locals.user.id));

  return {
    playlists,
    user: {
      id: locals.user.id,
      name: locals.user.name,
      role: (locals.user as { role?: string }).role ?? "user",
    },
  };
};
