import { auth } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { count } from "drizzle-orm";
import { redirect, type Handle } from "@sveltejs/kit";

const PUBLIC_PATHS = ["/login", "/setup", "/api/auth"];

export const handle: Handle = async ({ event, resolve }) => {
  // Attach session/user to locals
  const session = await auth.api.getSession({ headers: event.request.headers });
  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  const path = event.url.pathname;

  // Allow public paths and static assets
  if (PUBLIC_PATHS.some((p) => path.startsWith(p)) || path.startsWith("/_app")) {
    // If no users exist and not on setup, redirect to setup
    if (path.startsWith("/login")) {
      const [{ value: userCount }] = await db.select({ value: count() }).from(user);
      if (userCount === 0) redirect(302, "/setup");
    }
    return resolve(event);
  }

  // Require auth for everything else
  if (!event.locals.user) {
    redirect(302, "/login");
  }

  return resolve(event);
};
