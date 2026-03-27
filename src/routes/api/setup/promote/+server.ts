import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { count, eq } from "drizzle-orm";
import { logger } from "$lib/server/logger";
import type { RequestHandler } from "./$types";

const log = logger.child({ module: "setup" });

/**
 * Called right after the first user signs up to promote them to admin.
 * Only works when there is exactly 1 user in the database.
 */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401);

  const userId = locals.user.id;

  // Atomic check-and-promote: only promote if exactly one user exists.
  const promoted = await db.transaction(async (tx) => {
    const [{ value: userCount }] = await tx.select({ value: count() }).from(user);
    if (userCount !== 1) return false;
    await tx.update(user).set({ role: "admin" }).where(eq(user.id, userId));
    return true;
  });

  if (!promoted) {
    log.warn({ userId }, "promote rejected — setup already complete");
    error(403, "Setup already complete");
  }

  log.info({ userId }, "user promoted to admin");
  return json({ ok: true });
};
