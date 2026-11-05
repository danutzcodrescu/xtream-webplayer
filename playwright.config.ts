import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:5182";
const production = process.env.PLAYWRIGHT_TEST_PRODUCTION === "1";
const directory = mkdtempSync(join(tmpdir(), "webplayer-browser-"));

// Exercise upgrading an existing Playlist table, not just a fresh installation.
const legacy = new DatabaseSync(join(directory, "browser.sqlite"));
legacy.exec(`CREATE TABLE playlist (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL, serverUrl TEXT NOT NULL,
  xtreamUsername TEXT NOT NULL, xtreamPassword TEXT NOT NULL,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch())
)`);
legacy.close();

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 30_000,
  outputDir: join(directory, "results"),
  use: {
    baseURL,
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: production ? "node build" : "pnpm dev --host 127.0.0.1 --port 5182 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      NODE_ENV: production ? "production" : "development",
      HOST: "127.0.0.1",
      PORT: "5182",
      DATABASE_URL: join(directory, "browser.sqlite"),
      BETTER_AUTH_SECRET: "isolated-browser-test-secret-not-for-production",
      BETTER_AUTH_URL: baseURL,
      ORIGIN: baseURL,
      LOG_LEVEL: "silent",
    },
  },
});
