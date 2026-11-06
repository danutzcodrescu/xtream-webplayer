import { createServer } from "node:http";
import { test, expect } from "@playwright/test";

test("setup and login work; playback survives EPG outages and cross-host redirects", async ({
  page,
}) => {
  let epgUnavailable = false;
  let epgRateLimited = false;
  let rateLimitedRequests = 0;
  let shortEpgRequests = 0;
  let providerPort = 0;
  let crossHostRedirects = 0;
  // 87 silent AAC-LC frames (1024 samples each at 44.1 kHz), about two seconds.
  // Keep playback fixtures local and deterministic, without an ffmpeg dependency.
  const audio = Buffer.concat(
    Array.from({ length: 87 }, () => Buffer.from("//FQQAF//AEYIAc=", "base64")),
  );
  const channels = ["news", "sport"].flatMap((category, cat) =>
    Array.from({ length: 40 }, (_, index) => ({
      stream_id: cat * 100 + index + 1,
      name: cat === 1 && index === 30 ? "Target Sport" : `${category} ${index + 1}`,
      category_id: category,
      stream_icon: "",
      epg_channel_id: `${category}-${index}`,
    })),
  );
  const provider = createServer((request, response) => {
    const url = new URL(request.url!, "http://fixture.test");
    if (url.pathname.startsWith("/live/")) {
      if (request.headers.host === `localhost:${providerPort}`) {
        crossHostRedirects++;
        response.writeHead(302, { Location: `http://127.0.0.1:${providerPort}${request.url}` });
        response.end();
        return;
      }
      if (url.pathname.endsWith(".aac")) {
        response.setHeader("Content-Type", "audio/aac");
        response.end(audio);
      } else {
        response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        response.end(
          "#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXT-X-MEDIA-SEQUENCE:0\n" +
            "#EXT-X-PLAYLIST-TYPE:VOD\n" +
            "#EXTINF:2.020136,\nsilence.aac\n".repeat(20) +
            "#EXT-X-ENDLIST\n",
        );
      }
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (url.searchParams.get("action") === "get_short_epg") shortEpgRequests++;
    if (
      epgRateLimited &&
      ["get_simple_data_table", "get_short_epg"].includes(url.searchParams.get("action") ?? "")
    ) {
      rateLimitedRequests++;
      response.writeHead(429, { "Retry-After": "60" });
      response.end(JSON.stringify({ message: "Rate limited" }));
      return;
    }
    if (
      epgUnavailable &&
      ["get_simple_data_table", "get_short_epg"].includes(url.searchParams.get("action") ?? "")
    ) {
      response.writeHead(503);
      response.end(JSON.stringify({ message: "EPG offline" }));
      return;
    }
    switch (url.searchParams.get("action")) {
      case "get_live_categories":
        response.end(
          JSON.stringify([
            { category_id: "news", category_name: "News", parent_id: 0 },
            { category_id: "sport", category_name: "Sport", parent_id: 0 },
          ]),
        );
        break;
      case "get_live_streams":
        response.end(
          JSON.stringify(
            channels.filter(
              (c) =>
                !url.searchParams.has("category_id") ||
                c.category_id === url.searchParams.get("category_id"),
            ),
          ),
        );
        break;
      case "get_simple_data_table": {
        const now = Math.floor(Date.now() / 1000);
        response.end(
          JSON.stringify({
            epg_listings: [
              {
                id: "current",
                title: Buffer.from("Current Bulletin").toString("base64"),
                description: "",
                start_timestamp: now - 600,
                stop_timestamp: now + 1800,
              },
            ],
          }),
        );
        break;
      }
      default:
        response.end(JSON.stringify({ user_info: { auth: 1 } }));
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  providerPort = address.port;
  const pageErrors: string[] = [];
  let playlistId: string | undefined;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const setup = await page.request.get("/setup", { maxRedirects: 0 });
    if (setup.status() === 200) {
      // On a cold dev server, wait for client modules before submitting the SSR form.
      await page.goto("/setup", { waitUntil: "networkidle" });
      await page.getByLabel("Display Name", { exact: true }).fill("Browser Test");
      await page.getByLabel("Username", { exact: true }).fill("browser_fixture");
      await page.getByLabel("Password", { exact: true }).fill("test-only-password");
      await page.getByLabel("Confirm Password", { exact: true }).fill("test-only-password");
      await page.getByRole("button", { name: "Create Admin Account", exact: true }).click();
      await expect(page).toHaveURL(/\/watch$/);
      const signedOut = await page.request.post("/api/auth/sign-out", {
        headers: { Origin: "http://127.0.0.1:5182" },
        data: {},
      });
      expect(signedOut.ok()).toBe(true);
    }
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("Username", { exact: true }).fill("browser_fixture");
    await page.getByLabel("Password", { exact: true }).fill("test-only-password");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/watch$/);
    const created = await page.request.post("/api/playlists", {
      data: {
        name: "Fixture Playlist",
        serverUrl: `http://localhost:${address.port}`,
        xtreamUsername: "fixture",
        xtreamPassword: "fixture",
      },
    });
    expect(created.status()).toBe(201);
    playlistId = (await created.json()).id;
    await page.goto("/watch");
    await expect(page.getByRole("button", { name: "News", exact: true })).toBeVisible();
    await page.getByPlaceholder("Search channels…").fill("Target Sport");
    await expect(
      page.getByText(
        "Searches all Channel names and currently airing Programmes in already-loaded EPG.",
      ),
    ).toBeVisible();
    await page.getByRole("button").filter({ hasText: "Target Sport" }).click();
    await expect(page.getByPlaceholder("Search channels…")).toHaveValue("");
    await expect(page.getByTitle("Target Sport", { exact: true })).toBeVisible();
    const guide = page.getByRole("region", { name: "TV guide", exact: true });
    await expect.poll(() => guide.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
    const selected = await page.getByTitle("Target Sport", { exact: true }).boundingBox();
    const viewport = await guide.boundingBox();
    expect(
      selected && viewport && selected.y >= viewport.y && selected.y < viewport.y + viewport.height,
    ).toBeTruthy();

    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0.2);

    // Invalidate provider data so the next page load exercises a real upstream outage.
    epgUnavailable = true;
    const updated = await page.request.put(`/api/playlists/${playlistId}`, {
      data: { name: "Fixture Playlist" },
    });
    expect(updated.ok()).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "EPG unavailable — retry" }).first(),
    ).toBeVisible();
    await page.getByPlaceholder("Search channels…").fill("Target Sport");
    const streamResponse = page.waitForResponse(
      (response) => response.url().includes("/api/stream?") && response.status() === 200,
    );
    await page.getByRole("button").filter({ hasText: "Target Sport" }).click();
    await streamResponse;
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0.2);

    // A real provider 429 must pause metadata without blocking playback of visible Channels.
    // Warm interactive metadata before throttling; cached reads need no provider budget.
    await page.getByPlaceholder("Search channels…").fill("Target Sport");
    await page.request.put(`/api/playlists/${playlistId}`, { data: { name: "Fixture Playlist" } });
    expect((await page.request.get(`/api/categories?playlistId=${playlistId}`)).ok()).toBe(true);
    expect(
      (await page.request.get(`/api/channels?playlistId=${playlistId}&categoryId=news`)).ok(),
    ).toBe(true);
    epgRateLimited = true;
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Provider busy or unavailable");
    const throttledPlayback = page.waitForResponse(
      (response) => response.url().includes("/api/stream?") && response.status() === 200,
    );
    await page.getByTitle("news 1", { exact: true }).click();
    await throttledPlayback;
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0.2);
    expect(rateLimitedRequests).toBeGreaterThan(0);
    expect(rateLimitedRequests).toBeLessThanOrEqual(2);
    expect(shortEpgRequests).toBe(0);
    expect(crossHostRedirects).toBeGreaterThan(0);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Playlists", exact: true })).toBeVisible();
    await expect(page.getByLabel("Allowed CDN hosts")).toHaveCount(0);
    await page.getByRole("button", { name: "Add Playlist", exact: true }).click();
    await expect(page.getByLabel("Server URL", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Allowed CDN hosts")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      if (playlistId) await page.request.delete(`/api/playlists/${playlistId}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
