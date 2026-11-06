import { afterEach, describe, expect, it, vi } from "vitest";
import { XtreamApi } from "./xtream.js";
import { ProviderScheduler, retryAfterMs } from "./provider-scheduler.js";
import { authenticated, channel } from "../../test/fixtures.js";

afterEach(() => vi.unstubAllGlobals());

describe("Xtream request interface", () => {
  it("parses Retry-After seconds and dates without accepting invalid delays", () => {
    expect(retryAfterMs("60", 0)).toBe(60_000);
    expect(retryAfterMs("Thu, 01 Jan 1970 00:01:00 GMT", 0)).toBe(60_000);
    expect(retryAfterMs("invalid", 0)).toBe(0);
    expect(retryAfterMs(null, 0)).toBe(0);
  });

  it("shares a rate limit between separate API instances without another upstream call", async () => {
    const scheduler = new ProviderScheduler({ concurrency: 2, intervalMs: 0 });
    const fetch = vi.fn(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "90" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const credentials = {
      serverUrl: "https://provider.test",
      username: "user",
      password: "password",
    };
    await expect(new XtreamApi(credentials, scheduler).getSimpleDataTable(7)).rejects.toMatchObject(
      { status: 429, retryAfterMs: 90_000 },
    );
    await expect(
      new XtreamApi({ ...credentials, username: "another" }, scheduler).getLiveStreams(),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the same encoded credentials, headers, and timeout for authentication and Channel requests", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(authenticated))
      .mockResolvedValueOnce(Response.json([channel]));
    vi.stubGlobal("fetch", fetch);
    const provider = new XtreamApi(
      {
        serverUrl: "https://provider.test/",
        username: "user+name",
        password: "secret&value",
      },
      new ProviderScheduler({ concurrency: 2, intervalMs: 0 }),
    );
    expect(await provider.authenticate()).toEqual(authenticated);
    expect(await provider.getLiveStreams("news")).toEqual([channel]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://provider.test/player_api.php?username=user%2Bname&password=secret%26value",
      "https://provider.test/player_api.php?username=user%2Bname&password=secret%26value&action=get_live_streams&category_id=news",
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.headers).toEqual({ "User-Agent": "IPTV-WebPlayer/1.0" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("rejects failed HTTP responses for both authentication and data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 502 })),
    );
    const provider = new XtreamApi(
      {
        serverUrl: "https://provider.test",
        username: "user",
        password: "password",
      },
      new ProviderScheduler({ concurrency: 2, intervalMs: 0 }),
    );
    await expect(provider.authenticate()).rejects.toThrow("failed: 502");
    await expect(provider.getLiveCategories()).rejects.toThrow("failed: 502");
  });
});
