import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "$lib/server/logger";
import { auth } from "$lib/server/auth";
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
  if (body.banned !== undefined && typeof body.banned !== "boolean")
    error(400, "Invalid ban status");
  if (body.role === undefined && body.banned === undefined)
    error(400, "No account changes provided");

  if (body.banned !== undefined) {
    const changeBan = body.banned ? auth.api.banUser : auth.api.unbanUser;
    await changeBan({ body: { userId: params.id }, headers: request.headers });
  }
  if (body.role !== undefined) {
    await db.update(user).set({ role: body.role }).where(eq(user.id, params.id));
  }

  const [updated] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
    })
    .from(user)
    .where(eq(user.id, params.id));

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
