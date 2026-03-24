import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "./$types";

function requireAdmin(locals: App.Locals) {
  if (!locals.user) error(401);
  if ((locals.user as { role?: string }).role !== "admin") error(403, "Admin only");
}

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);

  const body = (await request.json()) as { role?: string; banned?: boolean };

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
  return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  requireAdmin(locals);

  // Prevent self-deletion
  if (params.id === locals.user?.id) error(400, "Cannot delete your own account");

  await db.delete(user).where(eq(user.id, params.id));
  return new Response(null, { status: 204 });
};
