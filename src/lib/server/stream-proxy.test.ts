import { describe, expect, it, vi } from "vitest";
import { StreamProxy } from "./stream-proxy.js";
import { encrypt } from "./crypto.js";
import type { PlaylistCredentials } from "./playlist-data.js";

const initial = (extra = "") =>
  new URL(`https://player.test/api/stream?playlistId=list&streamId=7${extra}`);
const manifest = (text: string) =>
  new Response(text, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
const proxied = (uri: string) => new URL(uri, "https://player.test");
const uris = (text: string) =>
  [...text.matchAll(/(?:^|URI=")(\/api\/stream\?token=[^"\r\n]+)/gm)].map((m) => m[1]);

function setup() {
  const credentials: PlaylistCredentials = {
    id: "list",
    serverUrl: "https://provider.test:8080",
    username: "secret-user",
    password: "secret-password",
  };
  const resolve = vi.fn(async () => credentials);
  const fetch = vi.fn<typeof globalThis.fetch>();
  return { credentials, resolve, fetch, proxy: new StreamProxy(resolve, fetch) };
}

describe("HLS proxy request interface", () => {
  it("proxies master, media, key/map attributes, query-relative URIs, and raw segments", async () => {
    const { proxy, fetch } = setup();
    fetch.mockResolvedValueOnce(
      manifest('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\nvideo/index.m3u8'),
    );
    const master = await (await proxy.respond(initial(), "owner")).text();
    expect(master).not.toContain("secret-");
    const masterUris = uris(master);
    expect(masterUris).toHaveLength(2);
    fetch.mockResolvedValueOnce(
      manifest(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key?sig=1"\n#EXT-X-MAP:URI="init.mp4"\n?segment=2',
      ),
    );
    const media = await (await proxy.respond(proxied(masterUris[1]), "owner")).text();
    const mediaUris = uris(media);
    expect(mediaUris).toHaveLength(3);
    fetch.mockImplementation(
      async () => new Response("binary data", { headers: { "Content-Type": "video/mp2t" } }),
    );
    for (const uri of mediaUris)
      expect(await (await proxy.respond(proxied(uri), "owner")).text()).toBe("binary data");
    expect(fetch.mock.calls.slice(-3).map(([url]) => url)).toEqual([
      "https://provider.test:8080/live/secret-user/secret-password/key?sig=1",
      "https://provider.test:8080/live/secret-user/secret-password/video/init.mp4",
      "https://provider.test:8080/live/secret-user/secret-password/video/index.m3u8?segment=2",
    ]);
  });

  it("follows cross-host redirects and proxies CDN segments without host configuration", async () => {
    const { proxy, fetch } = setup();
    fetch
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "https://cdn.test/live.m3u8" } }),
      )
      .mockResolvedValueOnce(manifest("#EXTM3U\nhttps://media.test/seg.ts"));
    const response = await proxy.respond(initial(), "owner");
    const links = uris(await response.text());
    expect(links).toHaveLength(1);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe("https://cdn.test/live.m3u8");
    fetch.mockResolvedValueOnce(new Response("segment"));
    expect(await (await proxy.respond(proxied(links[0]), "owner")).text()).toBe("segment");
    expect(fetch.mock.calls.at(-1)?.[0]).toBe("https://media.test/seg.ts");
    expect(fetch.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
  });

  it("rejects embedded credentials in manifest URLs and non-HTTP redirect protocols", async () => {
    const { proxy, fetch } = setup();
    fetch.mockResolvedValueOnce(
      manifest('#EXTM3U\n#EXT-X-KEY:URI="https://user:password@other.test/key"'),
    );
    await expect(proxy.respond(initial(), "owner")).rejects.toMatchObject({ status: 403 });
    fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: "file:///etc/passwd" } }),
    );
    await expect(proxy.respond(initial(), "owner")).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("follows chained CDN redirects without forwarding cookies across hosts", async () => {
    const { proxy, fetch } = setup();
    fetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location: "https://cdn.test/first.m3u8",
            "Set-Cookie": "provider-session=private; Path=/",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://another-cdn.test/last.m3u8" },
        }),
      )
      .mockResolvedValueOnce(manifest("#EXTM3U\nseg.ts"));
    expect((await proxy.respond(initial(), "owner")).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Headers(fetch.mock.calls[1][1]?.headers).has("Cookie")).toBe(false);
    expect(new Headers(fetch.mock.calls[2][1]?.headers).has("Cookie")).toBe(false);
  });

  it("binds encrypted tokens to the user and rechecks current Playlist access", async () => {
    const { proxy, fetch, resolve } = setup();
    fetch.mockResolvedValueOnce(manifest("#EXTM3U\nhttps://cdn.test/seg.ts"));
    const tokenUrl = proxied(uris(await (await proxy.respond(initial(), "owner")).text())[0]);
    await expect(proxy.respond(tokenUrl, "other")).rejects.toMatchObject({ status: 403 });
    resolve.mockRejectedValueOnce({ status: 404 });
    await expect(proxy.respond(tokenUrl, "owner")).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(
      proxy.respond(proxied("/api/stream?token=tampered"), "owner"),
    ).rejects.toMatchObject({ status: 400 });
    const malformed = encrypt(JSON.stringify({ url: 7, userId: "owner", playlistId: "list" }));
    await expect(
      proxy.respond(proxied(`/api/stream?token=${encodeURIComponent(malformed)}`), "owner"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps cookies per user, Playlist, and hostname, including across ports", async () => {
    const { proxy, fetch, credentials } = setup();
    fetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location: "https://provider.test/live.m3u8",
            "Set-Cookie": "session=a=b; Path=/",
          },
        }),
      )
      .mockResolvedValueOnce(manifest("#EXTM3U\nseg.ts"));
    const link = uris(await (await proxy.respond(initial(), "owner")).text())[0];
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get("Cookie")).toBe("session=a=b");
    fetch.mockImplementation(async () => new Response("segment"));
    await proxy.respond(proxied(link), "owner");
    expect(new Headers(fetch.mock.calls.at(-1)?.[1]?.headers).get("Cookie")).toBe("session=a=b");
    await proxy.respond(initial(), "other");
    expect(new Headers(fetch.mock.calls.at(-1)?.[1]?.headers).has("Cookie")).toBe(false);
    credentials.id = "another-list";
    await proxy.respond(initial(), "owner");
    expect(new Headers(fetch.mock.calls.at(-1)?.[1]?.headers).has("Cookie")).toBe(false);
  });

  it("supports catchup, limits redirects, and maps upstream failures without leaking credentials", async () => {
    const { proxy, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response("raw", { headers: { "Content-Type": "video/mp2t" } }));
    expect(
      await (await proxy.respond(initial("&start=1704067200&duration=60"), "owner")).text(),
    ).toBe("raw");
    expect(fetch.mock.calls[0][0]).toContain(
      "/timeshift/secret-user/secret-password/60/2024-01-01:00-00/7.m3u8",
    );
    fetch.mockImplementation(
      async () => new Response(null, { status: 302, headers: { Location: "/again.m3u8" } }),
    );
    await expect(proxy.respond(initial(), "owner")).rejects.toMatchObject({ status: 502 });
    expect(fetch).toHaveBeenCalledTimes(7);
    fetch.mockRejectedValueOnce(new Error("Timeout secret-password"));
    await expect(proxy.respond(initial(), "owner")).rejects.toMatchObject({
      status: 502,
      body: { message: "Stream server unavailable or timed out" },
    });
    await expect(proxy.respond(initial("&start=1&duration=0"), "owner")).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      proxy.respond(
        new URL("https://player.test/api/stream?playlistId=list&streamId=7oops"),
        "owner",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
