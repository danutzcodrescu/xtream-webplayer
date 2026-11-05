import { redirect } from "@sveltejs/kit";
import { playlistData } from "$lib/server/playlist";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, "/login");

  return {
    playlists: await playlistData.list(locals.user.id),
    user: {
      id: locals.user.id,
      name: locals.user.name,
      role: (locals.user as { role?: string }).role ?? "user",
    },
  };
};
