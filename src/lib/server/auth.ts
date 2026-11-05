import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { env } from "$env/dynamic/private";
import { db } from "./db/index.js";
import * as schema from "./db/schema.js";
import { count } from "drizzle-orm";

function createAuth() {
  if (!env.BETTER_AUTH_SECRET)
    throw new Error("BETTER_AUTH_SECRET environment variable is required");
  const baseURL = env.BETTER_AUTH_URL || env.ORIGIN || "http://localhost:5173";
  const trustedOrigins = [
    ...new Set([new URL(baseURL).origin, ...(env.ORIGIN ? [new URL(env.ORIGIN).origin] : [])]),
  ];
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path.startsWith("/sign-up/")) {
          const [{ value: userCount }] = await db.select({ value: count() }).from(schema.user);
          if (userCount > 0)
            throw new APIError("FORBIDDEN", {
              message: "Registration is closed; ask an administrator to create your account",
            });
        }
      }),
    },
    plugins: [
      username(),
      admin({
        defaultRole: "user",
        adminRole: "admin",
      }),
    ],
    secret: env.BETTER_AUTH_SECRET,
    advanced: { disableOriginCheck: false },
    baseURL,
    trustedOrigins,
  });
}

let _auth: ReturnType<typeof createAuth> | undefined;

export const auth: ReturnType<typeof createAuth> = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_, prop) {
    if (!_auth) _auth = createAuth();
    return _auth[prop as keyof ReturnType<typeof createAuth>];
  },
});
