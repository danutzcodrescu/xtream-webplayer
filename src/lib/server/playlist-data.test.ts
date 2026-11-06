import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db/index.js";
import { playlist, user } from "./db/schema.js";
import { encrypt } from "./crypto.js";
import { PlaylistData } from "./playlist-data.js";
import { XtreamApiError } from "./provider-scheduler.js";
import type { XtreamStream } from "./xtream.js";
import { authenticated, categories, channel, programme, deferred } from "../../test/fixtures.js";

function setup() {
  let time = 0;
  const provider = {
    authenticate: vi.fn(async () => authenticated),
    getLiveCategories: vi.fn(async () => categories),
    getLiveStreams: vi.fn(async () => [channel]),
    getSimpleDataTable: vi.fn(async () => ({ epg_listings: [programme] })),
    getShortEpg: vi.fn(async () => ({ epg_listings: [programme] })),
  };
  const factory = vi.fn(() => provider);
  const data = new PlaylistData(db, factory, () => time);
  return {
    data,
    provider,
    factory,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

beforeEach(async () => {
  await db.delete(user);
  await db.insert(user).values(
    ["owner", "other"].map((id) => ({
      id,
      name: id,
      email: `${id}@test.example`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  await db.insert(playlist).values({
    id: "list",
    userId: "owner",
    name: "My TV",
    serverUrl: encrypt("https://provider.test"),
    xtreamUsername: encrypt("provider-user"),
    xtreamPassword: encrypt("provider-password"),
  });
});

describe("owned Playlist data", () => {
  it("does not amplify rate limits with a short EPG fallback", async () => {
    const { data, provider } = setup();
    provider.getSimpleDataTable.mockRejectedValue(
      new XtreamApiError("get_simple_data_table", 429, 60_000),
    );
    await expect(data.epg("owner", "list", 7)).rejects.toMatchObject({ status: 429 });
    expect(provider.getShortEpg).not.toHaveBeenCalled();
  });

  it("retains stale EPG on failed refresh, suppresses retries, and expires it after six hours", async () => {
    const { data, provider, advance } = setup();
    await data.epg("owner", "list", 7);
    advance(300_000);
    provider.getSimpleDataTable.mockRejectedValue(
      new XtreamApiError("get_simple_data_table", 429, 60_000),
    );
    expect(await data.epgWithStatus("owner", "list", 7)).toMatchObject({
      value: [programme],
      stale: true,
      retryAfterMs: 60_000,
    });
    await data.epg("owner", "list", 7);
    expect(provider.getSimpleDataTable).toHaveBeenCalledTimes(2);
    await expect(data.epg("other", "list", 7)).rejects.toMatchObject({ status: 404 });
    advance(6 * 60 * 60 * 1000);
    await expect(data.epg("owner", "list", 7)).rejects.toMatchObject({ status: 429 });
    expect(provider.getShortEpg).not.toHaveBeenCalled();
  });

  it("returns only browser-facing Channel fields, never credential-bearing provider URLs", async () => {
    const { data, provider } = setup();
    const upstream = {
      ...channel,
      direct_source: "https://provider.test/live/provider-user/provider-password/7.m3u8",
      unexpected_url: "https://provider.test/hidden?password=provider-password",
    };
    provider.getLiveStreams.mockResolvedValue([upstream]);
    const expected = {
      stream_id: 7,
      name: channel.name,
      stream_icon: "",
      category_id: "news",
      epg_channel_id: "news",
      tv_archive: 1,
      tv_archive_duration: 7,
    };
    expect(await data.channels("owner", "list")).toEqual([expected]);
    expect(await data.channels("owner", "list")).toEqual([expected]);
    expect(JSON.stringify(await data.channels("owner", "list"))).not.toContain("provider-password");
  });

  it("checks ownership on every warm-cache read", async () => {
    const { data, provider } = setup();
    await data.categories("owner", "list");
    await data.channels("owner", "list");
    await data.epg("owner", "list", 7);
    await expect(data.categories("other", "list")).rejects.toMatchObject({ status: 404 });
    await expect(data.channels("other", "list")).rejects.toMatchObject({ status: 404 });
    await expect(data.epg("other", "list", 7)).rejects.toMatchObject({ status: 404 });
    expect(provider.getLiveStreams).toHaveBeenCalledTimes(1);
  });

  it("keeps ordering fresh while sharing cached provider Categories", async () => {
    const { data, provider } = setup();
    await data.categories("owner", "list");
    await data.saveCategoryOrder("owner", "list", [
      { categoryId: "sport", position: 0, hidden: true },
      { categoryId: "news", position: 1, hidden: false },
    ]);
    const result = await data.categories("owner", "list");
    expect(result.map((c) => c.category_id)).toEqual(["sport", "news"]);
    expect(result[0].hidden).toBe(true);
    expect(provider.getLiveCategories).toHaveBeenCalledTimes(1);
    await expect(data.saveCategoryOrder("other", "list", [])).rejects.toMatchObject({
      status: 404,
    });
  });

  it("invalidates data on edits and does not resurrect in-flight results", async () => {
    const { data, provider, factory } = setup();
    const old = deferred<XtreamStream[]>();
    provider.getLiveStreams.mockReturnValueOnce(old.promise);
    const pending = data.channels("owner", "list");
    await vi.waitFor(() => expect(provider.getLiveStreams).toHaveBeenCalledTimes(1));
    const safe = await data.update("owner", "list", {
      xtreamPassword: "replacement",
    });
    expect(safe).not.toHaveProperty("xtreamPassword");
    await data.channels("owner", "list");
    old.resolve([{ ...channel, name: "Obsolete" }]);
    await pending;
    expect((await data.channels("owner", "list"))[0].name).toBe(channel.name);
    expect(factory).toHaveBeenLastCalledWith(expect.objectContaining({ password: "replacement" }));
    expect(provider.getLiveStreams).toHaveBeenCalledTimes(2);
    await data.delete("owner", "list");
    await expect(data.channels("owner", "list")).rejects.toMatchObject({ status: 404 });
  });

  it("deduplicates requests and expires provider data", async () => {
    const { data, provider, advance } = setup();
    await Promise.all([data.channels("owner", "list"), data.channels("owner", "list")]);
    expect(provider.getLiveStreams).toHaveBeenCalledTimes(1);
    advance(6 * 60 * 60 * 1000);
    await data.channels("owner", "list");
    expect(provider.getLiveStreams).toHaveBeenCalledTimes(2);
  });

  it("falls back for EPG, decodes text, and retries rather than caching failure as emptiness", async () => {
    const { data, provider, advance } = setup();
    provider.getSimpleDataTable.mockRejectedValue(new XtreamApiError("get_simple_data_table", 404));
    provider.getShortEpg.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({
      epg_listings: [
        {
          ...programme,
          title: Buffer.from("Current affairs").toString("base64"),
          description: "Plain text description",
        },
      ],
    });
    await expect(data.epg("owner", "list", 7)).rejects.toThrow("Offline");
    expect((await data.epg("owner", "list", 7))[0]).toMatchObject({
      title: "Current affairs",
      description: "Plain text description",
    });
    await data.epg("owner", "list", 7);
    expect(provider.getShortEpg).toHaveBeenCalledTimes(2);
    advance(300_000);
    await data.epg("owner", "list", 7);
    expect(provider.getShortEpg).toHaveBeenCalledTimes(3);
  });

  it("creates safe Playlist descriptions without CDN host configuration", async () => {
    const { data } = setup();
    const created = await data.create("owner", {
      name: "Second",
      serverUrl: "https://provider.test/",
      xtreamUsername: "secret-user",
      xtreamPassword: "secret-password",
    });
    expect(created).not.toHaveProperty("allowedCdnHosts");
    expect(await data.credentials("owner", created.id)).not.toHaveProperty("allowedCdnHosts");
    expect(JSON.stringify(await data.list("owner"))).not.toContain("secret-password");
    await expect(
      data.update("owner", "list", { serverUrl: "file:///etc/passwd" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(data.update("other", "list", { name: "Not owned" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
