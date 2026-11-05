import type { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { encrypt } from "../crypto.js";

/** Apply generated migrations atomically, adopting pre-migration installations once. */
export function migrateDatabase(sqlite: DatabaseSync) {
  const migrations = readMigrationFiles({ migrationsFolder: resolve("drizzle") });
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC NOT NULL
    )`);
    const last = sqlite
      .prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1")
      .get();
    const legacy =
      !last &&
      !!sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user', 'playlist') LIMIT 1",
        )
        .get();
    for (const [index, migration] of migrations.entries()) {
      if (last && Number(last.created_at) >= migration.folderMillis) continue;
      for (const query of migration.sql) {
        if (legacy && index === 0) adoptInitialSchema(sqlite, query.trim());
        else sqlite.exec(query);
      }
      // Convert legacy data with the initial migration, before later SQL can rename fields.
      if (index === 0) {
        const rows = sqlite.prepare("SELECT id, serverUrl FROM playlist").all();
        for (const row of rows) {
          const value = String(row.serverUrl);
          if (!/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value)) {
            sqlite
              .prepare("UPDATE playlist SET serverUrl = ? WHERE id = ?")
              .run(encrypt(value), row.id);
          }
        }
      }
      sqlite
        .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run(migration.hash, migration.folderMillis);
    }

    sqlite.exec("COMMIT");
  } catch (cause) {
    sqlite.exec("ROLLBACK");
    throw cause;
  }
}

function identifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Only the generated initial migration is reconciled; later migrations run verbatim. */
function adoptInitialSchema(sqlite: DatabaseSync, query: string) {
  const table = /^CREATE TABLE `([^`]+)`/.exec(query)?.[1];
  if (
    table &&
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  ) {
    const existing = new Set(
      sqlite
        .prepare(`PRAGMA table_info(${identifier(table)})`)
        .all()
        .map((column) => column.name),
    );
    // Drizzle's baseline has one backtick-quoted column declaration per line.
    for (const line of query.split("\n")) {
      const column = /^\s*`([^`]+)` (.+?)(?:,)?$/.exec(line);
      if (column && !existing.has(column[1])) {
        sqlite.exec(
          `ALTER TABLE ${identifier(table)} ADD COLUMN ${identifier(column[1])} ${column[2]}`,
        );
      }
    }
    return;
  }
  sqlite.exec(query.replace(/^CREATE (UNIQUE )?INDEX /, "CREATE $1INDEX IF NOT EXISTS "));
}
