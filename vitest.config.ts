import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      "$app/env/private": fileURLToPath(new URL("./src/test/env.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: ":memory:",
      BETTER_AUTH_SECRET: "test-only-secret-not-for-production",
      LOG_LEVEL: "silent",
    },
  },
});
