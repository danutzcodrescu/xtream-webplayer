import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "./schema.js";
import { encrypt } from "../crypto.js";
import { logger } from "../logger.js";

const log = logger.child({ module: "db" });

const dbUrl = process.env.DATABASE_URL ?? "./data/iptv.db";

mkdirSync(dirname(dbUrl), { recursive: true });
log.info({ path: dbUrl }, "opening database");

const sqlite = new DatabaseSync(dbUrl);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

// Create all tables on startup — no migration step required
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS "user" (
    "id"               TEXT PRIMARY KEY,
    "name"             TEXT NOT NULL,
    "email"            TEXT NOT NULL UNIQUE,
    "emailVerified"    INTEGER NOT NULL DEFAULT 0,
    "image"            TEXT,
    "createdAt"        INTEGER NOT NULL,
    "updatedAt"        INTEGER NOT NULL,
    "username"         TEXT UNIQUE,
    "displayUsername"  TEXT,
    "role"             TEXT DEFAULT 'user',
    "banned"           INTEGER DEFAULT 0,
    "banReason"        TEXT,
    "banExpires"       INTEGER
  );

  CREATE TABLE IF NOT EXISTS "session" (
    "id"               TEXT PRIMARY KEY,
    "expiresAt"        INTEGER NOT NULL,
    "token"            TEXT NOT NULL UNIQUE,
    "createdAt"        INTEGER NOT NULL,
    "updatedAt"        INTEGER NOT NULL,
    "ipAddress"        TEXT,
    "userAgent"        TEXT,
    "userId"           TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "impersonatedBy"   TEXT
  );

  CREATE TABLE IF NOT EXISTS "account" (
    "id"                     TEXT PRIMARY KEY,
    "accountId"              TEXT NOT NULL,
    "providerId"             TEXT NOT NULL,
    "userId"                 TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "accessToken"            TEXT,
    "refreshToken"           TEXT,
    "idToken"                TEXT,
    "accessTokenExpiresAt"   INTEGER,
    "refreshTokenExpiresAt"  INTEGER,
    "scope"                  TEXT,
    "password"               TEXT,
    "createdAt"              INTEGER NOT NULL,
    "updatedAt"              INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "verification" (
    "id"         TEXT PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value"      TEXT NOT NULL,
    "expiresAt"  INTEGER NOT NULL,
    "createdAt"  INTEGER,
    "updatedAt"  INTEGER
  );

  CREATE TABLE IF NOT EXISTS "playlist" (
    "id"              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    "userId"          TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "name"            TEXT NOT NULL,
    "serverUrl"       TEXT NOT NULL,
    "xtreamUsername"  TEXT NOT NULL,
    "xtreamPassword"  TEXT NOT NULL,
    "createdAt"       INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS "category_order" (
    "playlistId"  TEXT NOT NULL REFERENCES "playlist"("id") ON DELETE CASCADE,
    "categoryId"  TEXT NOT NULL,
    "position"    INTEGER NOT NULL DEFAULT 0,
    "hidden"      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("playlistId", "categoryId")
  );
`);

log.info("applying schema");

// Migrate existing databases — safe to run repeatedly
try {
  sqlite.exec('ALTER TABLE "user" ADD COLUMN "username" TEXT');
  log.debug("migration: added user.username column");
} catch {
  /* already exists */
}
try {
  sqlite.exec('ALTER TABLE "user" ADD COLUMN "displayUsername" TEXT');
  log.debug("migration: added user.displayUsername column");
} catch {
  /* already exists */
}
try {
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS "user_username_unique" ON "user"("username")');
  log.debug("migration: created user_username_unique index");
} catch {
  /* already exists */
}

// Migrate: encrypt any plaintext serverUrls left from before this change.
// The encrypted format is always three colon-separated hex segments; a URL is not.
try {
  const rows = sqlite.prepare('SELECT id, serverUrl FROM "playlist"').all() as {
    id: string;
    serverUrl: string;
  }[];
  let migrated = 0;
  for (const row of rows) {
    const parts = row.serverUrl.split(":");
    const isEncrypted =
      parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
    if (!isEncrypted) {
      sqlite
        .prepare('UPDATE "playlist" SET serverUrl = ? WHERE id = ?')
        .run(encrypt(row.serverUrl), row.id);
      migrated++;
    }
  }
  if (migrated > 0) log.info({ migrated }, "migration: encrypted plaintext serverUrls");
} catch {
  /* table doesn't exist yet on a brand-new install — nothing to migrate */
}

log.info({ path: dbUrl }, "database ready");

export const db = drizzle(
	(sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		if (method === 'run') {
			stmt.run(...params);
			return { rows: [] };
		}
		const rows = stmt.all(...params) as Record<string, unknown>[];
		return { rows: rows.map((r) => Object.values(r)) };
	},
	{ schema }
);
