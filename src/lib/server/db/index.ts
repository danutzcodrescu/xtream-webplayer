import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";
import { migrateDatabase } from "./migrate.js";
import { logger } from "../logger.js";

const log = logger.child({ module: "db" });
const dbUrl = process.env.DATABASE_URL ?? "./data/db.sqlite";
mkdirSync(dirname(dbUrl), { recursive: true });
log.info({ path: dbUrl }, "opening database");

const sqlite = new DatabaseSync(dbUrl);
sqlite.exec("PRAGMA busy_timeout = 5000");
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");
try {
  migrateDatabase(sqlite);
} catch (cause) {
  sqlite.close();
  throw cause;
}
log.info({ path: dbUrl }, "database migrations applied");

export const db = drizzle(
  async (sql, params, method) => {
    const stmt = sqlite.prepare(sql);
    if (method === "run") {
      stmt.run(...params);
      return { rows: [] };
    }
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return { rows: rows.map((row) => Object.values(row)) };
  },
  { schema },
);
