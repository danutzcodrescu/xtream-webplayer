import { afterEach, describe, expect, it, vi } from "vitest";
import { XtreamApi } from "./xtream.js";
import { authenticated, channel } from "../../test/fixtures.js";

afterEach(() => vi.unstubAllGlobals());

describe("Xtream request interface", () => {
  it("uses the same encoded credentials, headers, and timeout for authentication and Channel requests", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(authenticated))
      .mockResolvedValueOnce(Response.json([channel]));
    vi.stubGlobal("fetch", fetch);
    const provider = new XtreamApi({
      serverUrl: "https://provider.test/",
      username: "user+name",
      password: "secret&value",
    });
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
    const provider = new XtreamApi({
      serverUrl: "https://provider.test",
      username: "user",
      password: "password",
    });
    await expect(provider.authenticate()).rejects.toThrow("failed: 502");
    await expect(provider.getLiveCategories()).rejects.toThrow("failed: 502");
  });
});
