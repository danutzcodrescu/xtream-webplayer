import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  GuideData,
  GuideRequestError,
  type GuideTransport,
  type Channel,
  type EpgEntry,
} from "./guide-data.js";
import { categories, channel, programme, deferred } from "../test/fixtures.js";

const guides: GuideData[] = [];
afterEach(() => {
  for (const guide of guides.splice(0)) guide.dispose();
  vi.useRealTimers();
});

function setup() {
  const transport = {
    categories: vi.fn<GuideTransport["categories"]>(async () =>
      categories.map((c) => ({ ...c, hidden: false })),
    ),
    channels: vi.fn<GuideTransport["channels"]>(async () => [channel]),
    epg: vi.fn<GuideTransport["epg"]>(async () => [programme]),
  };
  const guide = new GuideData(transport);
  guides.push(guide);
  return { transport, guide };
}

describe("Playlist-scoped guide state", () => {
  it("avoids simulated 429s when loading a burst of twenty Channels", async () => {
    const { guide, transport } = setup();
    await guide.setPlaylist("list");
    let active = 0;
    let peak = 0;
    transport.epg.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      try {
        if (active > 6) throw new Error("Xtream API get_short_epg failed: 429");
        await Promise.resolve();
        return [programme];
      } finally {
        active--;
      }
    });
    await Promise.all(Array.from({ length: 20 }, (_, id) => guide.loadEpg(id, 150_000)));
    expect(get(guide).epgErrors).toEqual({});
    expect(peak).toBeLessThanOrEqual(2);
    expect(transport.epg).toHaveBeenCalledTimes(20);
  });

  it("honors shared cooldown even for manual retry and automatically resumes visible rows", async () => {
    vi.useFakeTimers();
    const { guide, transport } = setup();
    await guide.setPlaylist("list");
    transport.epg.mockRejectedValueOnce(new GuideRequestError(60_000));
    guide.setVisibleChannels([1, 2, 3, 4], Date.now());
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.epg).toHaveBeenCalledTimes(2);
    expect(get(guide).providerRetryAt).toBe(Date.now() + 60_000);
    await guide.loadEpg(1, Date.now(), true);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(transport.epg).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(get(guide).providerRetryAt).toBe(0);
    expect(Object.keys(get(guide).epg)).toHaveLength(4);
    expect(transport.epg).toHaveBeenCalledTimes(5);
  });

  it("keeps stale listings visible on failure without extending their maximum lifetime", async () => {
    vi.useFakeTimers();
    const { guide, transport } = setup();
    await guide.setPlaylist("list");
    const expiresAt = Date.now() + 60_000;
    transport.epg.mockResolvedValueOnce({
      entries: [programme],
      stale: true,
      retryAfterMs: 30_000,
      expiresAt,
    });
    await guide.loadEpg(7, Date.now());
    expect(get(guide).epgStale[7]).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    transport.epg.mockRejectedValue(new Error("Offline"));
    await guide.loadEpg(7, Date.now(), true);
    expect(get(guide).epg[7]).toEqual([programme]);
    await vi.advanceTimersByTimeAsync(30_000);
    await guide.loadEpg(7, Date.now(), true);
    expect(get(guide).epg[7]).toBeUndefined();
  });

  it("does not let an EPG-only outage block Channel navigation or search", async () => {
    const { guide, transport } = setup();
    await guide.setPlaylist("list");
    transport.epg.mockRejectedValueOnce(new GuideRequestError(30_000, false));
    await guide.loadEpg(7, Date.now());
    expect(get(guide).providerRetryAt).toBe(0);
    expect(await guide.selectCategory("sport")).toBe(true);
    await guide.ensureAllChannels();
    expect(get(guide).allChannels).toEqual([channel]);
  });

  it("drops queued EPG when switching Playlist or disposing", async () => {
    const { guide, transport } = setup();
    await guide.setPlaylist("first");
    const blocked = deferred<EpgEntry[]>();
    transport.epg.mockReturnValue(blocked.promise);
    guide.setVisibleChannels([1, 2, 3], Date.now());
    await guide.setPlaylist("second");
    guide.dispose();
    blocked.resolve([programme]);
    await Promise.resolve();
    expect(transport.epg).toHaveBeenCalledTimes(2);
    expect(get(guide).epg).toEqual({});
  });

  it("bounds visible EPG concurrency and discards obsolete queued rows", async () => {
    const { guide, transport } = setup();
    await guide.setPlaylist("list");
    const blocked = deferred<EpgEntry[]>();
    transport.epg.mockReturnValue(blocked.promise);
    guide.setVisibleChannels([1, 2, 3, 4], 150_000);
    expect(transport.epg).toHaveBeenCalledTimes(2);
    guide.setVisibleChannels([5, 6], 150_000);
    blocked.resolve([programme]);
    await vi.waitFor(() => expect(transport.epg).toHaveBeenCalledTimes(4));
    expect(transport.epg.mock.calls.map((call) => call[1])).toEqual([1, 2, 5, 6]);
    guide.dispose();
  });

  it("ignores obsolete Category responses even if transport ignores cancellation", async () => {
    const { guide, transport } = setup();
    await guide.setPlaylist("first");
    const old = deferred<Channel[]>();
    transport.channels.mockReturnValueOnce(old.promise);
    const pending = guide.selectCategory("news");
    await guide.selectCategory("sport");
    old.resolve([{ ...channel, name: "Obsolete" }]);
    expect(await pending).toBe(false);
    expect(get(guide)).toMatchObject({
      activeCatId: "sport",
      channels: [channel],
      loadingChannels: false,
    });
    expect(transport.channels.mock.calls.at(-2)?.[2].aborted).toBe(true);
  });

  it("ignores old Playlist Categories, global search, and EPG with reused stream IDs", async () => {
    const { guide, transport } = setup();
    const oldCategories = deferred<Awaited<ReturnType<GuideTransport["categories"]>>>();
    transport.categories.mockReturnValueOnce(oldCategories.promise);
    const initial = guide.setPlaylist("old-categories");
    await guide.setPlaylist("first");
    oldCategories.resolve([{ category_id: "obsolete", category_name: "Old", hidden: false }]);
    await initial;
    expect(get(guide).categories[0].category_id).toBe("news");
    const oldSearch = deferred<Channel[]>();
    const oldEpg = deferred<EpgEntry[]>();
    transport.channels.mockReturnValueOnce(oldSearch.promise);
    transport.epg.mockReturnValueOnce(oldEpg.promise);
    const search = guide.ensureAllChannels();
    const epg = guide.loadEpg(7, 150_000);
    await guide.setPlaylist("second");
    await guide.loadEpg(7, 150_000);
    oldSearch.resolve([{ ...channel, name: "Old Playlist" }]);
    oldEpg.resolve([{ ...programme, title: "Old Programme" }]);
    await Promise.all([search, epg]);
    expect(get(guide)).toMatchObject({
      playlistId: "second",
      allChannels: [],
      epg: { 7: [programme] },
      loadingSearch: false,
    });
  });

  it("clears loading on failure and allows Category and global-search retries", async () => {
    const { guide, transport } = setup();
    transport.categories.mockRejectedValueOnce(new Error("Offline"));
    await guide.setPlaylist("list");
    expect(get(guide)).toMatchObject({ loadingCategories: false, error: expect.any(String) });
    await guide.retry();
    transport.channels.mockRejectedValueOnce(new Error("Offline"));
    await guide.selectCategory("sport");
    expect(get(guide).loadingChannels).toBe(false);
    expect(get(guide).error).not.toBe("");
    await guide.retry();
    expect(get(guide).error).toBe("");
    transport.channels.mockRejectedValueOnce(new Error("Offline"));
    await guide.ensureAllChannels();
    expect(get(guide).loadingSearch).toBe(false);
    expect(get(guide).searchError).not.toBe("");
    await guide.ensureAllChannels();
    expect(get(guide).allChannels).toEqual([channel]);
  });

  it("deduplicates visible EPG, distinguishes failure from emptiness, retries, and refreshes", async () => {
    const { guide, transport } = setup();
    await guide.setPlaylist("list");
    const request = deferred<EpgEntry[]>();
    transport.epg.mockReturnValueOnce(request.promise);
    const pending = guide.loadEpg(7, 150_000);
    await guide.loadEpg(7, 150_000);
    expect(transport.epg).toHaveBeenCalledTimes(1);
    request.reject(new Error("Offline"));
    await pending;
    expect(get(guide).epg[7]).toBeUndefined();
    expect(get(guide).epgErrors[7]).toBe("EPG unavailable");
    await guide.loadEpg(7, 150_000, true);
    expect(get(guide).epg[7]).toEqual([programme]);
    expect(get(guide).epgErrors[7]).toBeUndefined();
    await guide.loadEpg(7, 450_000);
    expect(transport.epg).toHaveBeenCalledTimes(3);
  });

  it("searches all Channel names but only loaded, currently airing Programme titles", async () => {
    const { guide, transport } = setup();
    await guide.setPlaylist("list");
    transport.channels.mockResolvedValueOnce([
      channel,
      { ...channel, stream_id: 8, name: "Sport Channel" },
    ]);
    await guide.ensureAllChannels();
    guide.setSearch("Sport", 150_000);
    expect(get(guide).searchResults[0].channel.stream_id).toBe(8);
    guide.setSearch("Daily Bulletin", 150_000);
    expect(get(guide).searchResults).toEqual([]);
    await guide.loadEpg(7, 150_000);
    expect(get(guide).searchResults[0].matchedProgramme).toBe("Daily Bulletin");
    await guide.selectCategory("sport");
    expect(get(guide).searchResults).toHaveLength(1); // Category changes do not erase loaded coverage.
    guide.setSearch("Daily Bulletin", 200_000);
    expect(get(guide).searchResults).toEqual([]);
    expect(transport.epg).toHaveBeenCalledTimes(1); // Search does not prefetch EPG.
  });

  it("does not refetch a successful empty search list and ignores work after disposal", async () => {
    const { guide, transport } = setup();
    await guide.setPlaylist("list");
    transport.channels.mockResolvedValueOnce([]);
    await guide.ensureAllChannels();
    const calls = transport.channels.mock.calls.length;
    await guide.ensureAllChannels();
    expect(transport.channels).toHaveBeenCalledTimes(calls);
    const old = deferred<EpgEntry[]>();
    transport.epg.mockReturnValueOnce(old.promise);
    const pending = guide.loadEpg(7, 150_000);
    guide.dispose();
    old.resolve([programme]);
    await pending;
    expect(get(guide).epg).toEqual({});
  });
});
