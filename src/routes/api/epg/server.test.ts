import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "$lib/server/db/index.js";
import { playlist, user } from "$lib/server/db/schema.js";
import { encrypt } from "$lib/server/crypto.js";
import { GET } from "./+server.js";
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
    serverUrl: encrypt("https://provider.test"),
    xtreamUsername: encrypt("provider-user"),
    xtreamPassword: encrypt("provider-password"),
  });
});

afterEach(() => vi.unstubAllGlobals());

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

    await expect(request()).rejects.toMatchObject({
      status: 503,
      body: { message: "EPG temporarily unavailable. Please retry." },
    });
    expect(fetch.mock.calls).toHaveLength(2);
    expect(
      fetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("action")),
    ).toEqual(["get_simple_data_table", "get_short_epg"]);

    // A provider outage must not be cached as a successful empty guide.
    fetch.mockResolvedValue(Response.json({ epg_listings: [programme] }));
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([programme]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("handles network failures without exposing provider credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(request()).rejects.toMatchObject({
      status: 503,
      body: { message: "EPG temporarily unavailable. Please retry." },
    });
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
