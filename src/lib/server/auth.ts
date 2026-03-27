import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { env } from "$env/dynamic/private";
import { db } from "./db/index.js";
import * as schema from "./db/schema.js";

function createAuth() {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET environment variable is required");
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
    plugins: [
      username(),
      admin({
        defaultRole: "user",
        adminRole: "admin",
      }),
    ],
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:5173",
    trustedOrigins: [env.BETTER_AUTH_URL ?? "http://localhost:5173"],
  });
}

let _auth: ReturnType<typeof createAuth> | undefined;

export const auth: ReturnType<typeof createAuth> = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_, prop) {
    if (!_auth) _auth = createAuth();
    return _auth[prop as keyof ReturnType<typeof createAuth>];
  },
});
