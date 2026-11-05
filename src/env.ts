import { defineEnvVars } from "@sveltejs/kit/env";

// Keep these private and runtime-resolved; builds do not need deployment secrets.
// Auth and encryption validate the secret when first used.
export const variables = defineEnvVars({
  BETTER_AUTH_SECRET: { schema: (value) => value },
  BETTER_AUTH_URL: { schema: (value) => value },
  ORIGIN: { schema: (value) => value },
});
