import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "$lib/server/db/index.js";
import { playlist, user } from "$lib/server/db/schema.js";
import { encrypt } from "$lib/server/crypto.js";
import { GET } from "./+server.js";
import { GET as channels } from "../channels/+server.js";
import { GET as categories } from "../categories/+server.js";
import { programme } from "../../../test/fixtures.js";

let playlistId: string;

beforeEach(async () => {
  playlistId = randomUUID();
  await db.delete(user);
  await db.insert(user).values({
    id: "owner",
    name: "Owner",
    email: "owner@test.example",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(playlist).values({
    id: playlistId,
    userId: "owner",
    name: "My TV",
    serverUrl: encrypt(`https://${playlistId}.provider.test`),
    xtreamUsername: encrypt("provider-user"),
    xtreamPassword: encrypt("provider-password"),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function request(userId: string | null = "owner", query = `playlistId=${playlistId}&streamId=7`) {
  return GET({
    url: new URL(`https://player.test/api/epg?${query}`),
    locals: { user: userId ? { id: userId } : null },
  } as Parameters<typeof GET>[0]);
}

describe("EPG endpoint", () => {
  it("handles a provider 503 as temporary EPG unavailability instead of an unhandled error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);

    const unavailable = await request();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      message: "EPG temporarily unavailable. Please retry.",
    });
    expect(unavailable.headers.get("Retry-After")).toBe("30");
    expect(fetch.mock.calls).toHaveLength(1);
    expect(
      fetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("action")),
    ).toEqual(["get_simple_data_table"]);

    // A provider outage must not be cached as a successful empty guide.
    fetch.mockResolvedValue(Response.json({ epg_listings: [programme] }));
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([programme]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("handles network failures without exposing provider credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      message: "EPG temporarily unavailable. Please retry.",
    });
  });

  it("returns Retry-After and shares EPG cooldown with Channel and Category endpoints", async () => {
    const fetch = vi.fn(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "90" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("90");
    const event = {
      url: new URL(`https://player.test/api/channels?playlistId=${playlistId}`),
      locals: { user: { id: "owner" } },
    };
    for (const blocked of [
      await channels(event as Parameters<typeof channels>[0]),
      await categories(event as Parameters<typeof categories>[0]),
    ]) {
      expect(blocked.status).toBe(503);
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(JSON.stringify(await blocked.json())).not.toContain("provider-password");
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns stale listings with expiry and cooldown headers after a failed refresh", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ epg_listings: [programme] }))
      .mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetch);
    const fresh = await request();
    expect(fresh.headers.get("X-EPG-Stale")).toBe("false");
    now.mockReturnValue(1_300_000);
    const stale = await request();
    expect(stale.status).toBe(200);
    expect(stale.headers.get("X-EPG-Stale")).toBe("true");
    expect(stale.headers.get("Retry-After")).toBe("60");
    expect(stale.headers.get("X-EPG-Expires-At")).toBe(fresh.headers.get("X-EPG-Expires-At"));
    expect(await stale.json()).toEqual([programme]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps cached Channel and Category reads available during provider cooldown", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json([]));
    vi.stubGlobal("fetch", fetch);
    const event = {
      url: new URL(`https://player.test/api/channels?playlistId=${playlistId}`),
      locals: { user: { id: "owner" } },
    };
    await channels(event as Parameters<typeof channels>[0]);
    await categories(event as Parameters<typeof categories>[0]);
    fetch.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await request()).status).toBe(503);
    expect((await channels(event as Parameters<typeof channels>[0])).status).toBe(200);
    expect((await categories(event as Parameters<typeof categories>[0])).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("preserves authentication, ownership, and input errors without calling the provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(request(null)).rejects.toMatchObject({ status: 401 });
    await expect(request("other")).rejects.toMatchObject({ status: 404 });
    await expect(request("owner", `playlistId=${playlistId}&streamId=0`)).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
