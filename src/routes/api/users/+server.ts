import { json, error } from "@sveltejs/kit";
import { auth } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { logger } from "$lib/server/logger";
import type { RequestHandler } from "./$types";

const log = logger.child({ module: "users" });

function requireAdmin(locals: App.Locals) {
  if (!locals.user) error(401);
  if (locals.user.role !== "admin") error(403, "Admin only");
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
  if (body.password.length < 8) {
    error(400, "Password must be at least 8 characters");
  }

  // Derive a synthetic email so Better Auth's email requirement is satisfied
  const syntheticEmail = `${body.username.toLowerCase()}@iptv.local`;

  const role = body.role === "admin" ? "admin" : "user";
  const res = await auth.api.createUser({
    body: {
      name: body.name,
      email: syntheticEmail,
      password: body.password,
      role,
      // @ts-expect-error — username field added by username plugin
      username: body.username,
    },
    headers: new Headers(),
  });

  log.info({ username: body.username, role, createdBy: locals.user?.id }, "user created");
  return json(res, { status: 201 });
};
