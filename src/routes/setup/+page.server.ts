import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { count } from "drizzle-orm";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  // If already logged in, skip setup
  if (locals.user) redirect(302, "/watch");

  // If users already exist, setup is not allowed
  const [{ value: userCount }] = await db.select({ value: count() }).from(user);
  if (userCount > 0) redirect(302, "/login");
};
