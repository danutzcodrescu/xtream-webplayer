import { auth } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
import { count } from "drizzle-orm";
import { redirect, type Handle } from "@sveltejs/kit";
import { logger } from "$lib/server/logger";

const log = logger.child({ module: "hooks" });

const PUBLIC_PATHS = ["/login", "/setup", "/api/auth"];

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "media-src 'self' blob:", // blob: for hls.js MSE, self for proxied streams
    "img-src 'self' data: blob:",
    "connect-src 'self'",
  ].join("; "),
};

function applySecurityHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const handle: Handle = async ({ event, resolve }) => {
  const { method } = event.request;
  const path = event.url.pathname;

  log.debug({ method, path }, "request");

  // Attach session/user to locals
  const session = await auth.api.getSession({ headers: event.request.headers });
  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  // Allow public paths and static assets
  if (PUBLIC_PATHS.some((p) => path.startsWith(p)) || path.startsWith("/_app")) {
    // If no users exist and not on setup, redirect to setup
    if (path.startsWith("/login")) {
      const [{ value: userCount }] = await db.select({ value: count() }).from(user);
      if (userCount === 0) {
        log.info("no users found, redirecting to setup");
        redirect(302, "/setup");
      }
    }
    return applySecurityHeaders(await resolve(event));
  }

  // Require auth for everything else
  if (!event.locals.user) {
    log.debug({ path }, "unauthenticated request, redirecting to login");
    redirect(302, "/login");
  }

  return applySecurityHeaders(await resolve(event));
};
