import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt, decrypt } from "../crypto.js";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_URL",
    join(mkdtempSync(join(tmpdir(), "webplayer-migration-")), "fixture.sqlite"),
  );
});

describe("database startup", () => {
  it("creates a fresh database and preserves its records across repeated startup", async () => {
    const { db } = await import("./index.js");
    const { user, playlist } = await import("./schema.js");
    await db.insert(user).values({
      id: "owner",
      name: "Owner",
      email: "owner@fixture.test",
      username: "owner",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(playlist).values({
      id: "list",
      userId: "owner",
      name: "Fixture",
      serverUrl: encrypt("https://provider.test"),
      xtreamUsername: encrypt("fixture-user"),
      xtreamPassword: encrypt("fixture-password"),
    });
    vi.resetModules();
    const restarted = await import("./index.js");
    const records = await restarted.db.select().from(playlist);
    expect(records).toHaveLength(1);
    expect(records[0].allowedCdnHosts).toEqual([]);
    expect(decrypt(records[0].serverUrl)).toBe("https://provider.test");
    expect((await restarted.db.select().from(user))[0].username).toBe("owner");
  });

  it.each([false, true])(
    "upgrades legacy tables without data loss (existing CDN column: %s)",
    async (hasCdnColumn) => {
      const legacy = new DatabaseSync(process.env.DATABASE_URL!);
      legacy.exec(`CREATE TABLE user (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, role TEXT DEFAULT 'user',
      banned INTEGER DEFAULT 0, banReason TEXT, banExpires INTEGER
    ); CREATE TABLE playlist (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      name TEXT NOT NULL, serverUrl TEXT NOT NULL, xtreamUsername TEXT NOT NULL, xtreamPassword TEXT NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch())${hasCdnColumn ? ", allowedCdnHosts TEXT NOT NULL DEFAULT '[]'" : ""}
    ); INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES ('owner', 'Legacy Owner', 'legacy@fixture.test', 1, 1);`);
      legacy
        .prepare(
          "INSERT INTO playlist (id, userId, name, serverUrl, xtreamUsername, xtreamPassword) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          "list",
          "owner",
          "Legacy TV",
          "https://legacy-provider.test",
          encrypt("fixture-user"),
          encrypt("fixture-password"),
        );
      if (hasCdnColumn)
        legacy
          .prepare("UPDATE playlist SET allowedCdnHosts = ?")
          .run(JSON.stringify(["cdn.fixture.test"]));
      legacy.close();
      const { db } = await import("./index.js");
      const { user, playlist } = await import("./schema.js");
      const [upgraded] = await db.select().from(playlist);
      expect(upgraded.allowedCdnHosts).toEqual(hasCdnColumn ? ["cdn.fixture.test"] : []);
      expect(decrypt(upgraded.serverUrl)).toBe("https://legacy-provider.test");
      await db.update(user).set({ username: "legacy_owner", displayUsername: "Legacy Owner" });
      vi.resetModules();
      const restarted = await import("./index.js");
      expect((await restarted.db.select().from(playlist))[0].serverUrl).toBe(upgraded.serverUrl);
      expect((await restarted.db.select().from(user))[0].username).toBe("legacy_owner");
    },
  );
});
