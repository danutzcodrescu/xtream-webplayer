import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "$lib/server/logger";
import type { RequestHandler } from "./$types";

const log = logger.child({ module: "users" });

function requireAdmin(locals: App.Locals) {
  if (!locals.user) error(401);
  if (locals.user.role !== "admin") error(403, "Admin only");
}

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);

  const body = (await request.json()) as { role?: string; banned?: boolean };

  if (body.role !== undefined && body.role !== "admin" && body.role !== "user") {
    error(400, "Invalid role");
  }

  const [updated] = await db
    .update(user)
    .set({
      ...(body.role !== undefined && { role: body.role }),
      ...(body.banned !== undefined && { banned: body.banned }),
    })
    .where(eq(user.id, params.id))
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
    });

  if (!updated) error(404);
  log.info({ targetUserId: params.id, changes: body, by: locals.user?.id }, "user updated");
  return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  requireAdmin(locals);

  // Prevent self-deletion
  if (params.id === locals.user?.id) error(400, "Cannot delete your own account");

  await db.delete(user).where(eq(user.id, params.id));
  log.info({ targetUserId: params.id, by: locals.user?.id }, "user deleted");
  return new Response(null, { status: 204 });
};
