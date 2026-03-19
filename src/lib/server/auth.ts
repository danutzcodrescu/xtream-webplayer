import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { db } from "./db/index.js";
import * as schema from "./db/schema.js";

export const auth = betterAuth({
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
  secret: process.env.BETTER_AUTH_SECRET ?? "fallback-dev-secret-change-in-production",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:5173"],
});
