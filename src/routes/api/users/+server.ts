import { json, error } from "@sveltejs/kit";
import { auth } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import type { RequestHandler } from "./$types";

function requireAdmin(locals: App.Locals) {
  if (!locals.user) error(401);
  if ((locals.user as { role?: string }).role !== "admin") error(403, "Admin only");
}

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      banned: user.banned,
    })
    .from(user);

  return json(users);
};

export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);

  const body = (await request.json()) as {
    name: string;
    username: string;
    password: string;
    role?: string;
  };

  if (!body.name || !body.username || !body.password) {
    error(400, "name, username and password are required");
  }

  // Derive a synthetic email so Better Auth's email requirement is satisfied
  const syntheticEmail = `${body.username.toLowerCase()}@iptv.local`;

  const res = await auth.api.createUser({
    body: {
      name: body.name,
      email: syntheticEmail,
      password: body.password,
      role: body.role === "admin" ? "admin" : "user",
      // @ts-expect-error — username field added by username plugin
      username: body.username,
    },
    headers: new Headers(),
  });

  return json(res, { status: 201 });
};
