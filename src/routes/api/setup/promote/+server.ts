import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { count, eq } from "drizzle-orm";
import type { RequestHandler } from "./$types";

/**
 * Called right after the first user signs up to promote them to admin.
 * Only works when there is exactly 1 user in the database.
 */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401);

  const [{ value: userCount }] = await db.select({ value: count() }).from(user);
  if (userCount !== 1) {
    error(403, "Setup already complete");
  }

  await db.update(user).set({ role: "admin" }).where(eq(user.id, locals.user.id));

  return json({ ok: true });
};
