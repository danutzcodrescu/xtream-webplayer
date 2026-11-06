import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      // Concurrent browser-test servers must not overwrite the local dev environment.
      outDir: process.env.SVELTEKIT_OUT_DIR,
      preprocess: vitePreprocess(),
      alias: { $lib: "src/lib" },
    }),
  ],
  optimizeDeps: {
    exclude: ["better-sqlite3"],
  },
  server: {
    port: 5173,
  },
});
